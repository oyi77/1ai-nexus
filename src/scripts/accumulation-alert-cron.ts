#!/usr/bin/env node
// -------------------------------------------------------------
// Whale accumulation alert cron.
//
// Reads data/wallet-buys-latest.json (written by wallet-refresh-cron /
// kol-monitor-cron via foldWalletBuys), cross-references the classified
// SmartMoneyWallet rows, and emits ONE telegram alert per token per
// cooldown when a bullish-classified wallet made a confirmed buy of
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
// -------------------------------------------------------------

import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'
import { contractButtons } from '@/lib/modules/derived/signal-tier'
import {
  ACCUMULATION_BUYER_STATUSES,
  ACCUMULATION_DEFAULTS,
  buildAccumulationEvents,
  dedupeEventsByContract,
  renderAccumulationAlert,
  shouldSend,
  type AccumulationOptions,
} from '@/lib/modules/derived/accumulation-alert'
import { markSent, pruneAccumulationState, readState, writeState } from '@/lib/modules/derived/accumulation-state'
import type { WalletBuyCandidate } from '@/lib/modules/derived/wallet-discovery'

interface WalletBuysArtifact {
  generated_at?: string
  min_usd?: number
  window_min?: number
  candidates?: Array<Partial<WalletBuyCandidate>>
}

interface MarketRow {
  marketCapUsd: number | null
  liquidityUsd: number | null
  symbol: string | null
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function artifactPath(): string {
  return process.env.WALLET_BUYS_PATH ?? join(process.cwd(), 'data', 'wallet-buys-latest.json')
}

function readArtifactCandidates(): WalletBuyCandidate[] | null {
  const path = artifactPath()
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as WalletBuysArtifact
    const candidates = raw.candidates
    if (!Array.isArray(candidates) || candidates.length === 0) return null
    const out: WalletBuyCandidate[] = []
    for (const c of candidates) {
      if (
        typeof c.contract !== 'string' ||
        typeof c.buyVolumeUsd !== 'number' ||
        !Number.isFinite(c.buyVolumeUsd) ||
        !Array.isArray(c.buyers) ||
        c.buyers.length === 0
      ) {
        continue
      }
      out.push({
        contract: c.contract,
        chain: 'solana',
        discoveredBy: typeof c.discoveredBy === 'string' ? c.discoveredBy : c.buyers[0],
        buyers: c.buyers.filter((b): b is string => typeof b === 'string'),
        buyVolumeUsd: c.buyVolumeUsd,
        buyCount: typeof c.buyCount === 'number' ? c.buyCount : c.buyers.length,
        firstBuyAt: typeof c.firstBuyAt === 'number' ? c.firstBuyAt : 0,
        lastBuyAt: typeof c.lastBuyAt === 'number' ? c.lastBuyAt : 0,
        discoveryEvidence: [],
      })
    }
    return out.length > 0 ? out : null
  } catch (err) {
    console.error(`[accumulation-alert] artifact read failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function loadBuyerStatus(): Promise<
  Map<string, { status: string; alias: string | null; winRate?: number | null; pnl?: number | null }>
> {
  const map = new Map<
    string,
    { status: string; alias: string | null; winRate?: number | null; pnl?: number | null }
  >()
  try {
    const rows = await prisma.smartMoneyWallet.findMany({
      where: { status: { in: [...ACCUMULATION_BUYER_STATUSES] } },
      select: {
        status: true,
        winRate: true,
        pnl30d: true,
        wallet: { select: { address: true, alias: true } },
      },
    })
    for (const row of rows) {
      map.set(row.wallet.address, {
        status: row.status ?? 'UNKNOWN',
        alias: row.wallet.alias ?? null,
        winRate: row.winRate ?? null,
        pnl: row.pnl30d ?? null,
      })
    }
  } catch (err) {
    console.error(
      `[accumulation-alert] smartMoneyWallet query failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return map
}

async function loadMarkets(candidates: WalletBuyCandidate[]): Promise<Map<string, MarketRow>> {
  const map = new Map<string, MarketRow>()
  try {
    const contracts = [...new Set(candidates.map((c) => c.contract))]
    const tokens = await prisma.token.findMany({
      where: { address: { in: contracts }, chain: { in: ['solana'] } },
      select: { address: true, chain: true, symbol: true, marketCap: true },
    })
    for (const t of tokens) {
      map.set(t.address, { marketCapUsd: t.marketCap, liquidityUsd: null, symbol: t.symbol })
    }
    // LaunchToken is the only schema model with liquidityUsd; prefer it
    // for the same mint when present (it also carries a fresher MC).
    const launches = await prisma.launchToken.findMany({
      where: { address: { in: contracts }, chain: { in: ['solana'] } },
      select: { address: true, chain: true, symbol: true, marketCapUsd: true, liquidityUsd: true },
    })
    for (const l of launches) {
      map.set(l.address, { marketCapUsd: l.marketCapUsd, liquidityUsd: l.liquidityUsd, symbol: l.symbol })
    }
  } catch (err) {
    console.error(`[accumulation-alert] market query failed: ${err instanceof Error ? err.message : String(err)}`)
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

  const candidates = readArtifactCandidates()
  if (candidates === null) {
    console.log('[accumulation-alert] no wallet-buy candidates — no data, no alert')
    process.exit(0)
  }
  console.log(`[accumulation-alert] artifact: ${candidates.length} candidate(s)`)

  const buyerStatus = await loadBuyerStatus()
  const markets = await loadMarkets(candidates)
  console.log(`[accumulation-alert] classified bullish wallets: ${buyerStatus.size}`)

  const events = dedupeEventsByContract(
    buildAccumulationEvents({ candidates, buyerStatus, market: markets, opts }),
  )
  console.log(`[accumulation-alert] events: ${events.length}`)

  let sent = 0
  let suppressed = 0
  let deliveryFailures = 0
  let state = pruneAccumulationState(readState(), now)

  for (const event of events) {
    if (!shouldSend(event, state, now, opts.cooldownMs)) {
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
      console.log(`[accumulation-alert] sent ${event.token.contract} (${event.buyers.length} buyer(s), $${event.totalBuyUsd.toFixed(2)})`)
    } else {
      deliveryFailures += 1
      console.error(`[accumulation-alert] delivery failed ${event.token.contract}`)
    }
  }

  if (sent > 0) writeState(state)

  console.log(
    `[accumulation-alert] done: events=${events.length} sent=${sent} ` +
      `suppressed=${suppressed} delivery_failures=${deliveryFailures}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('[accumulation-alert] FATAL:', err)
  process.exit(1)
})
