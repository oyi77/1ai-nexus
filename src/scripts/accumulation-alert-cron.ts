#!/usr/bin/env node
// -------------------------------------------------------------
// Whale accumulation alert cron.
// Reads wallet-buy candidates (WalletBuySignal DB / JSON artifact),
// classifies each buyer under the 4-category taxonomy (fresh_wallet / kol /
// other_coin_whale / smart_money), and emits ONE telegram alert per token
// per cooldown when at least one tagged buyer made a confirmed buy of
// >= minBuyUsd on a token with verified market cap < maxMarketCapUsd.
//
// Safe: no data, no alert; delivery failure logs and exits 0.
//
// Run: npm run cron:accumulation-alert
// Env:
//   ACCUMULATION_MIN_BUY_USD               (default 1000)
//   ACCUMULATION_MAX_MC_USD                (default 1000000)
//   ACCUMULATION_COOLDOWN_MS               (default 6h)
//   ACCUMULATION_AGGREGATION_WINDOW_MS     (default 1h, metadata)
//   ACCUMULATION_STATE_PATH                (default data/accumulation-alert-state.json)
//   ACCUMULATION_TRUSTED_CALL_GROUPS       comma-separated vetted call groups
// -------------------------------------------------------------

import 'dotenv/config'
import { prisma } from '@/lib/db'
import { loadWalletBuys } from '@/lib/modules/derived/db-wallet-buys'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'
import { contractButtons } from '@/lib/modules/derived/signal-tier'
import {
  ACCUMULATION_DEFAULTS,
  buildAccumulationEvents,
  dedupeEventsByContract,
  renderAccumulationAlert,
  shouldSend,
  type AccumulationOptions,
  type BuyerFacts,
} from '@/lib/modules/derived/accumulation-alert'
import { isAccumulationSeen, markAccumulationSeen, markSent, pruneAccumulationState, readState, writeState } from '@/lib/modules/derived/accumulation-state'
import { loadMarkets } from '@/lib/modules/derived/accumulation-markets'
import { evaluateStrategiesFor } from '@/lib/modules/derived/strategy-intake'
import { STRATEGY_DEFAULTS } from '@/lib/modules/derived/strategy-evaluator'
import type { WalletBuyCandidate } from '@/lib/modules/derived/wallet-discovery'

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Load wallet-buy candidates DB-first (WalletBuySignal), falling back to the
 * JSON artifact inside loadWalletBuys when the DB is empty/unreachable. The
 * same per-row validation discipline as the legacy file reader is preserved:
 * a row without a finite buyVolumeUsd or a non-empty buyers list is dropped,
 * never coerced into a signal.
 */
async function readArtifactCandidates(): Promise<WalletBuyCandidate[] | null> {
  try {
    const rows = await loadWalletBuys()
    const out: WalletBuyCandidate[] = []
    for (const c of rows) {
      if (
        typeof c.contract !== 'string' ||
        typeof c.buyVolumeUsd !== 'number' ||
        !Number.isFinite(c.buyVolumeUsd) ||
        !Array.isArray(c.buyers) ||
        c.buyers.length === 0
      ) {
        continue
      }
      const buyers = c.buyers.filter((b): b is string => typeof b === 'string')
      out.push({
        contract: c.contract,
        chain: 'solana',
        discoveredBy: buyers[0],
        buyers,
        buyVolumeUsd: c.buyVolumeUsd,
        buyCount: typeof c.buyCount === 'number' ? c.buyCount : buyers.length,
        firstBuyAt: typeof c.firstBuyAt === 'number' ? c.firstBuyAt : 0,
        lastBuyAt: typeof c.lastBuyAt === 'number' ? c.lastBuyAt : 0,
        discoveryEvidence: [],
      })
    }
    return out.length > 0 ? out : null
  } catch (err) {
    console.error(`[accumulation-alert] candidate load failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Load buyer facts (Wallet labels/alias + SmartMoneyWallet status +
 * TokenHolding rows) for the addresses referenced by the candidates. Unlike
 * the old gate this queries EVERY buyer address — including never-classified
 * wallets — so that fresh_wallet and kol tags surface. Never throws: on DB
 * failure returns an empty map (every buyer then classifies as fresh_wallet
 * via the missing-entry fallback in the builder).
 *
 * The TokenHolding lookup is ONE batched query keyed on wallet address (no
 * N+1) and is fully optional: when a wallet has no holdings the field stays
 * an empty array, and the cross-token refinement degrades to the
 * wallet-global meaning it always had.
 */
async function loadBuyerStatus(addresses: string[]): Promise<Map<string, BuyerFacts>> {
  const map = new Map<string, BuyerFacts>()
  if (addresses.length === 0) return map
  try {
    // Wallet carries labels + alias (KOL/FIRST_SEEN signals). SmartMoneyWallet
    // is a 1:1 relation carrying the classifier status/winRate/pnl. A wallet
    // with no SMW row (never classified) still returns — status stays null.
    const wallets = await prisma.wallet.findMany({
      where: { address: { in: addresses } },
      select: {
        address: true,
        alias: true,
        labels: true,
        smartMoneyWallet: {
          select: { status: true, winRate: true, pnl30d: true },
        },
      },
    })

    // Cross-token evidence (GAP-1): the wallet's known holdings, batched in
    // ONE query filtered by the SAME address set. Only wallets that have
    // TokenHolding rows appear; everyone else stays with holdings = [].
    const holdingsByAddress = new Map<string, Array<{ tokenAddress: string; usdValue: number }>>()
    try {
      const holdings = await prisma.tokenHolding.findMany({
        where: { wallet: { address: { in: addresses } } },
        select: {
          wallet: { select: { address: true } },
          token: { select: { address: true } },
          usdValue: true,
        },
      })
      for (const h of holdings) {
        const addr = h.wallet?.address
        const tokenAddress = h.token?.address
        if (!addr || !tokenAddress) continue
        let arr = holdingsByAddress.get(addr)
        if (!arr) {
          arr = []
          holdingsByAddress.set(addr, arr)
        }
        arr.push({ tokenAddress, usdValue: h.usdValue })
      }
    } catch (err) {
      // Holdings are strictly additive evidence; a failed lookup must not
      // drop the wallet rows we already loaded.
      console.error(
        `[accumulation-alert] TokenHolding query failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }

    for (const w of wallets) {
      const smw = w.smartMoneyWallet
      map.set(w.address, {
        status: smw?.status ?? null,
        alias: w.alias ?? null,
        labels: w.labels ?? [],
        winRate: smw?.winRate ?? null,
        pnl: smw?.pnl30d ?? null,
        walletHoldings: holdingsByAddress.get(w.address) ?? [],
      })
    }
  } catch (err) {
    console.error(
      `[accumulation-alert] wallet query failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return map
}

async function main() {
  const now = Date.now()
  const opts: AccumulationOptions = {
    minBuyUsd: numEnv('ACCUMULATION_MIN_BUY_USD', ACCUMULATION_DEFAULTS.minBuyUsd),
    maxMarketCapUsd: numEnv('ACCUMULATION_MAX_MC_USD', ACCUMULATION_DEFAULTS.maxMarketCapUsd),
    cooldownMs: numEnv('ACCUMULATION_COOLDOWN_MS', ACCUMULATION_DEFAULTS.cooldownMs),
    aggregationWindowMs: numEnv(
      'ACCUMULATION_AGGREGATION_WINDOW_MS',
      ACCUMULATION_DEFAULTS.aggregationWindowMs,
    ),
  }

  console.log(`[accumulation-alert] ${new Date(now).toISOString()} — starting`)
  console.log(
    `[accumulation-alert] minBuyUsd=${opts.minBuyUsd} maxMcUsd=${opts.maxMarketCapUsd} ` +
      `cooldownMs=${opts.cooldownMs} windowMs=${opts.aggregationWindowMs}`,
  )

  const candidates = await readArtifactCandidates()
  if (candidates === null) {
    console.log('[accumulation-alert] no wallet-buy candidates — no data, no alert')
    process.exit(0)
  }
  console.log(`[accumulation-alert] artifact: ${candidates.length} candidate(s)`)

  const buyerAddresses = [...new Set(candidates.flatMap((c) => c.buyers))]
  const buyerStatus = await loadBuyerStatus(buyerAddresses)
  const markets = await loadMarkets(candidates)
  console.log(`[accumulation-alert] buyer facts loaded: ${buyerStatus.size}/${buyerAddresses.length}`)

  const events = dedupeEventsByContract(
    buildAccumulationEvents({ candidates, buyerStatus, market: markets, opts }),
  )
  console.log(`[accumulation-alert] events: ${events.length}`)

  let sent = 0
  let suppressed = 0
  let deliveryFailures = 0
  let state = pruneAccumulationState(readState(), now)

  // Strategy gate inputs (operator mandate: >= 10 price-guard holders,
  // liquidity/volume floors, per-strategy MC bands). Sizing is optional —
  // without it the alert still names the setup but shows no ladder.
  const capitalUsd = numEnv('ACCUMULATION_CAPITAL_USD', 0)
  const riskPct = numEnv('ACCUMULATION_RISK_PCT', 0.01)
  const strategyConfig = {
    minPriceGuardHolders: numEnv('ACCUMULATION_MIN_GUARD_HOLDERS', STRATEGY_DEFAULTS.minPriceGuardHolders),
    minLiquidityUsd: numEnv('ACCUMULATION_MIN_LIQUIDITY_USD', STRATEGY_DEFAULTS.minLiquidityUsd),
    minVolume24hUsd: numEnv('ACCUMULATION_MIN_VOLUME_24H_USD', STRATEGY_DEFAULTS.minVolume24hUsd),
  }
  // Vetted call groups (comma-separated). Reported as trusted confluence;
  // an empty list means no group is vetted yet — honest, not a blanket pass.
  const trustedCallGroups = (process.env.ACCUMULATION_TRUSTED_CALL_GROUPS ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
  let strategyRefused = 0

  for (const event of events) {
    const tagSummary = event.categories.join('+')
    console.log(
      `[accumulation-alert] event ${event.token.contract} tier=${event.tier} ` +
        `categories=${tagSummary} buyers=${event.buyers.length} $${event.totalBuyUsd.toFixed(2)}`,
    )

    // Evaluate the operator's three strategies against real MC structure.
    // A token with NO firing strategy is not a tradeable signal: it is
    // logged and dropped rather than delivered with an entry claim.
    const intake = await evaluateStrategiesFor({
      contract: event.token.contract,
      buyers: event.buyers.map((b) => b.address),
      buyerStatus: new Map(event.buyers.map((b) => [b.address, { status: b.status ?? null }])),
      market: markets.get(event.token.contract) ?? null,
      config: strategyConfig,
      sizing: capitalUsd > 0 ? { capitalUsd, riskPct } : undefined,
      trustedCallGroups,
    })
    event.strategy = intake.fired
    event.ladder = intake.ladder
    event.structure = intake.structureLines
    event.callGroups = intake.confluence.available ? intake.confluenceLine : null

    if (!intake.fired) {
      strategyRefused += 1
      console.log(
        `[accumulation-alert] no strategy fired ${event.token.contract}: ${intake.refusals.join(' | ')}`,
      )
      continue
    }
    console.log(
      `[accumulation-alert] strategy=${intake.fired.strategy} conf=${intake.fired.confidence} ` +
        `entry=${intake.fired.entryUsd} sl=${intake.fired.stopUsd} contract=${event.token.contract} ` +
        `guards=${intake.guardSource ?? 'unknown'} ` +
        `callGroups=${intake.confluence.available ? intake.confluence.groupCount : 'n/a'}`,
    )

    if (!shouldSend(event, state, now, opts.cooldownMs) || (await isAccumulationSeen(event.token.contract))) {
      suppressed += 1
      console.log(`[accumulation-alert] suppressed (cooldown) ${event.token.contract}`)
      continue
    }
    const text = renderAccumulationAlert(event)
    const replyMarkup = contractButtons(event.token.contract, event.token.chain)
    const ok = await deliverSniperAlert(text, undefined, replyMarkup)
    if (ok) {
      sent += 1
      state = markSent(state, event.token.contract, now)
      await markAccumulationSeen(event.token.contract, opts.cooldownMs)
      console.log(`[accumulation-alert] sent ${event.token.contract} (${event.buyers.length} buyer(s), $${event.totalBuyUsd.toFixed(2)})`)
    } else {
      deliveryFailures += 1
      console.error(`[accumulation-alert] delivery failed ${event.token.contract}`)
    }
  }

  if (sent > 0) writeState(state)

  console.log(
    `[accumulation-alert] done: events=${events.length} sent=${sent} ` +
      `suppressed=${suppressed} strategy_refused=${strategyRefused} delivery_failures=${deliveryFailures}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('[accumulation-alert] FATAL:', err)
  process.exit(1)
})
