// ─────────────────────────────────────────────────────────────
// Wallet discovery — the operator's ask, verbatim: "download wallet
// dari tokens MC >$1M ke atas, yang aktif dan PnL bagus + winrate bagus"
// plus the hard mandate: "pastikan hasil screening bukan bot."
//
// THREE legs, all keyed to measured data, no fabrication:
//
//   A. Leaderboard sweep — every WHALE_HARVEST_TAGS tag × {7d, 30d},
//      deduped via the existing mergeRowGmgn fold. Refuses any row the
//      verifier rejects.
//
//   B. High-cap holder extraction — tokens from GMGN's established feed
//      with marketCap >= $1M, top holders pulled from the holders
//      endpoint, each address re-measured via fetchGmgnWalletStats.
//
//   C. Human vs bot classification (operator mandate) — a copy of the
//      proven rules from axiom-monitor:
//        · fastTxRatio >= 50%  → bot (sniper automation, not a human)
//        · buys with ZERO sells 30d → bot (dump-and-abandon)
//        · buyCount30d < 10    → UNKNOWN, refused (unclassifiable)
//      A wallet cannot enter the tracked pool without passing C. The
//      classifier result is WRITTEN to reasons so the operator can
//      audit every admission.
//
// Persisted through the Wallet → SmartMoneyWallet one-to-one upsert the
// schema defines. Nothing is averaged in; a wallet with no measured
// winRate/pnl never enters the pool.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  discoverEstablishedGmgnTokens,
  fetchGmgnWalletStats,
  listGmgnTokenHolders,
  listGmgnWalletRank,
  type GmgnWalletStats,
} from '@/lib/modules/meme/gmgn'
import { verifyWhaleForList } from '@/lib/modules/meme/whale-verifier'
import { WHALE_HARVEST_TAGS, mergeRowGmgn, type HarvestedWallet } from '@/lib/modules/meme/whale-harvester'
import { SMART_MONEY_DEFAULTS } from './wallet-intel'

/**
 * Run `fn` over `items` with bounded concurrency. The discovery legs call a
 * ~0.7s/wallet endpoint; sequential loops made one pass take hours (a live
 * dry run hung past 600s), so every fan-out goes through here. Failures are
 * collected as null, never thrown.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  deadlineMs: number = Number.POSITIVE_INFINITY,
): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null)
  const stopAt = Date.now() + deadlineMs
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      // The budget is checked per item so a slow provider degrades the pass
      // to a partial one instead of hanging it (a live dry run once hung
      // past 600s with sequential calls and no ceiling).
      if (Date.now() > stopAt) return
      const i = cursor++
      if (i >= items.length) return
      try {
        out[i] = await fn(items[i])
      } catch {
        out[i] = null
      }
    }
  })
  await Promise.all(workers)
  return out
}

export interface DiscoveryFilters {
  /** 30d win-rate floor (fraction). SMART_MONEY_DEFAULTS.winRateMin = 0.6. */
  minWinRate: number
  /** 30d PnL floor (fraction of volume). SMART_MONEY_DEFAULTS.pnl30dMin = 0.7. */
  minPnl: number
  /** 30d buy volume floor — whale-scale participation. */
  minBuyVolumeUsd: number
  /** Minimum token market cap for the high-cap holder leg. */
  minEstablishedMc: number
  /** Max established tokens to inspect per pass. */
  maxTokens: number
  /** Max holders per token to re-measure. */
  maxHoldersPerToken: number
  /** Anti-bot: max fraction of buys that were sniper-fast (axiom rule). */
  maxFastTxRatio: number
  /** Parallel wallet-stat requests (the endpoint is ~0.7s/call). */
  concurrency: number
  /** Hard wall-clock budget per pass; the pass stops fanning out past it. */
  budgetMs: number
  /**
   * Stop the holder leg after this many tokens return zero holder rows.
   * GMGN only serves holders for pump.fun-origin mints, so a run of empties
   * means the rest of the list will be empty too — measured, not assumed.
   */
  maxEmptyHolderTokens: number
  /**
   * Max wallets to re-measure with fetchGmgnWalletStats per pass.
   * GMGN's limiter allows 60 requests/minute, so 307 prefilter survivors
   * needed ~307s and looked like a hang. Survivors are sorted by 30d buy
   * volume first, so the cap keeps the largest whales, not a random slice.
   */
  maxStatMeasurements: number
}

export const DISCOVERY_DEFAULTS: DiscoveryFilters = {
  minWinRate: SMART_MONEY_DEFAULTS.winRateMin,
  minPnl: SMART_MONEY_DEFAULTS.pnl30dMin,
  minBuyVolumeUsd: SMART_MONEY_DEFAULTS.whaleBuyVolume30dUsd,
  minEstablishedMc: 1_000_000,
  maxTokens: 20,
  maxHoldersPerToken: 100,
  maxFastTxRatio: 0.5,
  concurrency: 6,
  budgetMs: 120_000,
  maxEmptyHolderTokens: 2,
  maxStatMeasurements: 150,
}

export type WalletLeg = 'leaderboard' | 'high-cap-holders'
export type HumanVerdict = 'HUMAN' | 'BOT_FAST_TX' | 'BOT_BUY_ONLY' | 'UNKNOWN'

export interface HumanCheck {
  verdict: HumanVerdict
  reason: string
}

/**
 * Human vs bot, per the operator's mandate ("pastikan bukan bot").
 * Mirrors axiom-monitor's classifyHuman; kept local so discovery has a
 * single self-contained contract. null fields ⇒ UNKNOWN (refused),
 * never assumed human.
 */
export function classifyHuman(
  stats: Pick<GmgnWalletStats, 'fastTxRatio' | 'buyCount30d' | 'sellCount30d'>,
  f: DiscoveryFilters,
): HumanCheck {
  const fastTx = stats.fastTxRatio
  const buys = stats.buyCount30d
  const sells = stats.sellCount30d

  if (buys === null || buys < 10) {
    return { verdict: 'UNKNOWN', reason: 'too few trades to classify (needs >= 10 in 30d)' }
  }
  if (fastTx !== null && fastTx >= f.maxFastTxRatio) {
    return {
      verdict: 'BOT_FAST_TX',
      reason: `fastTxRatio ${(fastTx * 100).toFixed(1)}% >= ${(f.maxFastTxRatio * 100).toFixed(0)}% — sniper automation, not human`,
    }
  }
  if (sells === null || sells === 0) {
    // Unknown sell count is NOT a pass: the operator's mandate is to prove a
    // wallet is not a bot, and a wallet whose exits are unmeasured proves
    // nothing. Zero sells is the dump-and-abandon pattern.
    return {
      verdict: sells === 0 ? 'BOT_BUY_ONLY' : 'UNKNOWN',
      reason:
        sells === 0
          ? `${buys} buys, 0 sells in 30d — dump-and-abandon bot pattern`
          : 'sell count unreported — cannot prove the wallet exits positions',
    }
  }
  return { verdict: 'HUMAN', reason: `fastTx ${(fastTx ?? 0).toFixed(2)}, ${buys} buys / ${sells} sells — human trading cadence` }
}

export interface DiscoveredWallet {
  address: string
  name: string | null
  source: string
  winRate30d: number | null
  pnl30d: number | null
  realizedProfit30d: number | null
  buyVolume30d: number | null
  buyCount30d: number | null
  sellCount30d: number | null
  tags: string[]
  verdict: 'WHALE' | 'QUALITY' | null
  leg: WalletLeg
  human: HumanCheck
}

function establishedMc(tok: { marketCap?: number }): number | null {
  return typeof tok.marketCap === 'number' && tok.marketCap > 0 ? tok.marketCap : null
}

/** Leg A — leaderboard sweep, deduped, filtered. */
async function sweepLeaderboard(f: DiscoveryFilters): Promise<DiscoveredWallet[]> {
  const merged = new Map<string, { w: HarvestedWallet; tags: string[] }>()
  const stopAt = Date.now() + f.budgetMs
  for (const window of ['7d', '30d'] as const) {
    for (const tag of WHALE_HARVEST_TAGS) {
      // 18 tags × 2 windows = 36 sequential rank calls. Without this guard a
      // pass could not finish inside any window (observed: 300s+ and rising).
      if (Date.now() > stopAt) break
      let rows: Awaited<ReturnType<typeof listGmgnWalletRank>> = []
      try {
        rows = await listGmgnWalletRank(tag, window)
      } catch {
        rows = [] // the rank call already degrades internally; a double guard is harmless
      }
      for (const row of rows) {
        const candidate: HarvestedWallet = {
          address: row.address,
          name: '',
          source: tag,
          winRate30d: row.winRate30d,
          pnl30d: row.pnl30d,
          realizedProfit30d: row.realizedProfit30d,
          buyVolume30d: row.buyVolume30d,
          windows: [window],
        }
        const existing = merged.get(row.address)
        if (existing) {
          merged.set(row.address, {
            w: mergeRowGmgn(existing.w, candidate),
            tags: [...new Set([...existing.tags, ...row.tags])],
          })
        } else {
          merged.set(row.address, { w: candidate, tags: row.tags })
        }
      }
    }
  }

  // Prefilter BEFORE spending a stats call: leaderboard rows already carry
  // winRate30d/pnl30d/buyVolume30d, so the verifier can reject most wallets
  // for free. This matters because GMGN's rate limiter allows 60 requests per
  // minute — measuring all ~413 merged wallets needed ~7 minutes and made the
  // pass look hung (live: killed at 260s and 300s with only "start" printed).
  const survivors: Array<[string, { w: HarvestedWallet; tags: string[] }]> = []
  for (const entry of merged.entries()) {
    const verdict = verifyWhaleForList({
      winRate30d: entry[1].w.winRate30d,
      pnl30d: entry[1].w.pnl30d,
      buyVolume30d: entry[1].w.buyVolume30d,
    })
    if (verdict.include) survivors.push(entry)
  }

  // Rank QUALITY FIRST, then volume, then cap. Measured live 2026-10-20:
  // 562 merged wallets → 307 cleared the free prefilter, but only 4 cleared
  // the final gate (wr≥0.6 AND pnl≥0.7). Sorting by volume alone spent the
  // measurement budget on 150 whales and then dropped ALL of them at the
  // quality gate — those 4 were at risk of never being measured at all.
  const clearsQuality = (w: HarvestedWallet): number =>
    (w.winRate30d ?? 0) >= f.minWinRate && (w.pnl30d ?? 0) >= f.minPnl ? 1 : 0
  survivors.sort(
    (a, b) =>
      clearsQuality(b[1].w) - clearsQuality(a[1].w) ||
      (b[1].w.buyVolume30d ?? 0) - (a[1].w.buyVolume30d ?? 0),
  )
  const toMeasure = survivors.slice(0, f.maxStatMeasurements)
  const statsList = await mapLimit(
    toMeasure,
    f.concurrency,
    ([address]) => fetchGmgnWalletStats(address).catch(() => null),
    f.budgetMs,
  )
  const out: DiscoveredWallet[] = []
  for (let idx = 0; idx < toMeasure.length; idx++) {
    const [address, { w, tags }] = toMeasure[idx]
    const stats = statsList[idx]
    const human = classifyHuman(
      { fastTxRatio: stats?.fastTxRatio ?? null, buyCount30d: stats?.buyCount30d ?? null, sellCount30d: stats?.sellCount30d ?? null },
      f,
    )
    const verdict = verifyWhaleForList({
      winRate30d: w.winRate30d,
      pnl30d: w.pnl30d,
      buyVolume30d: w.buyVolume30d,
    })
    if (!verdict.include) continue
    if (human.verdict !== 'HUMAN') continue
    out.push({
      address,
      name: w.name || null,
      source: w.source,
      winRate30d: w.winRate30d,
      pnl30d: w.pnl30d,
      realizedProfit30d: w.realizedProfit30d,
      buyVolume30d: w.buyVolume30d,
      buyCount30d: stats?.buyCount30d ?? null,
      sellCount30d: stats?.sellCount30d ?? null,
      tags,
      verdict: verdict.label === 'WHALE' || verdict.label === 'QUALITY' ? verdict.label : null,
      leg: 'leaderboard',
      human,
    })
  }
  return out
}

/** Leg B — high-cap holders, re-measured, human-gated. */
async function sweepHighCapHolders(f: DiscoveryFilters): Promise<DiscoveredWallet[]> {
  // The established feed returns volume-sorted tokens with real caps.
  const tokens = await discoverEstablishedGmgnTokens(f.maxTokens, { minVolumeUsd: 100_000, minAgeHours: 24 })

  // Gather candidates first; measuring 100+ holders per token sequentially
  // was the reason a pass could not finish inside its window.
  const candidates: Array<{ address: string; source: string }> = []
  const seen = new Set<string>()
  let emptyHolderTokens = 0
  const stopAt = Date.now() + f.budgetMs
  for (const tok of tokens) {
    if (Date.now() > stopAt) break
    const mc = establishedMc(tok)
    if (mc === null || mc < f.minEstablishedMc) continue
    let holders: Array<{ address?: string; pct?: number }> = []
    try {
      // GMGN's holders endpoint only returns rows for pump.fun-origin mints;
      // established tokens (pPOLY/XDP/QQQB measured live) come back EMPTY after
      // a ~6.5s retry, and every keyless alternative failed (Solscan 403/DNS,
      // RugCheck 400 on report/summary). Skip after the first empty response
      // per token rather than burning the whole budget on dead calls.
      holders = await listGmgnTokenHolders('solana', tok.contract)
    } catch {
      continue // one unreachable token must not kill the leg
    }
    if (holders.length === 0) {
      emptyHolderTokens++
      if (emptyHolderTokens >= f.maxEmptyHolderTokens) break
      continue
    }
    for (const h of holders.slice(0, f.maxHoldersPerToken)) {
      const address = typeof h?.address === 'string' && h.address.length > 20 ? h.address : null
      if (!address || seen.has(address)) continue
      seen.add(address)
      candidates.push({ address, source: `gmgn-holder:${tok.contract.slice(0, 6)}` })
    }
  }

  const statsList = await mapLimit(
    candidates,
    f.concurrency,
    (c) => fetchGmgnWalletStats(c.address).catch(() => null),
    f.budgetMs,
  )
  const out: DiscoveredWallet[] = []
  for (let i = 0; i < candidates.length; i++) {
    const stats = statsList[i]
    if (!stats) continue
    const human = classifyHuman(stats, f)
    if (human.verdict !== 'HUMAN') continue
    // A holder row carries no 30d leaderboard win rate, so the whale
    // verifier cannot judge this leg — only the measured pnl can.
    if (stats.pnl30d === null || stats.pnl30d <= 0) continue
    out.push({
      address: candidates[i].address,
      name: null,
      source: candidates[i].source,
      winRate30d: null,
      pnl30d: stats.pnl30d,
      realizedProfit30d: stats.realizedProfit30d,
      buyVolume30d: null,
      buyCount30d: stats.buyCount30d,
      sellCount30d: stats.sellCount30d,
      tags: stats.tags,
      verdict: null,
      leg: 'high-cap-holders',
      human,
    })
  }
  return out
}

export interface DiscoveryResult {
  discovered: DiscoveredWallet[]
  refused: { noMeasure: number; bot: number; filters: number }
  leaderboardLeg: number
  highCapLeg: number
}

/**
 * Full pass. Deterministic given the same upstream data; every refusal
 * is counted and the reason class named, so the operator can audit
 * exactly why a wallet did NOT enter the pool.
 */
export async function runWalletDiscovery(
  overrides: Partial<DiscoveryFilters> = {},
  paceMs = 400,
): Promise<DiscoveryResult> {
  const f = { ...DISCOVERY_DEFAULTS, ...overrides }

  // Stage timings are permanent: a pass that appeared to "hang" was really
  // spending minutes in one leg, and without these stamps that was invisible
  // in the cron log (only the start line printed).
  const tA = Date.now()
  const leaderboard = await sweepLeaderboard(f)
  const aMs = Date.now() - tA
  await new Promise((r) => setTimeout(r, paceMs))
  const tB = Date.now()
  const highCap = await sweepHighCapHolders(f)
  const bMs = Date.now() - tB
  logger.info(
    `wallet discovery legs: leaderboard=${leaderboard.length} in ${aMs}ms, ` +
      `highCapHolders=${highCap.length} in ${bMs}ms`,
    'wallet-discovery',
  )

  const byAddress = new Map<string, DiscoveredWallet>()
  const refused = { noMeasure: 0, bot: 0, filters: 0 }
  for (const w of [...leaderboard, ...highCap]) {
    if (w.winRate30d === null || w.pnl30d === null) {
      refused.noMeasure++
      continue
    }
    if (w.human.verdict !== 'HUMAN') {
      refused.bot++
      continue
    }
    if (w.pnl30d < f.minPnl || (w.winRate30d ?? 0) < f.minWinRate) {
      refused.filters++
      continue
    }
    if (w.leg === 'high-cap-holders' && w.realizedProfit30d === null) {
      refused.noMeasure++
      continue
    }
    const existing = byAddress.get(w.address)
    if (existing) {
      existing.tags = [...new Set([...existing.tags, ...w.tags])]
      if (existing.leg === 'high-cap-holders' && w.leg === 'leaderboard') existing.leg = 'leaderboard'
      existing.verdict = existing.verdict ?? w.verdict
    } else {
      byAddress.set(w.address, w)
    }
  }

  return {
    discovered: [...byAddress.values()],
    refused,
    leaderboardLeg: leaderboard.length,
    highCapLeg: highCap.length,
  }
}

/** Persist through the Wallet → SmartMoneyWallet one-to-one. Idempotent. */
export async function persistWallets(discovered: DiscoveredWallet[]): Promise<number> {
  let written = 0
  for (const w of discovered) {
    try {
      const wallet = await prisma.wallet.upsert({
        where: { address: w.address },
        create: {
          address: w.address,
          chain: 'solana',
          labels: [w.source],
          lastSeen: new Date(),
        },
        update: {
          labels: { push: w.source },
        },
      })
      const reason = `discovered:${w.leg}:${w.source};${w.human.verdict};${w.human.reason}`
      await prisma.smartMoneyWallet.upsert({
        where: { walletId: wallet.id },
        create: {
          walletId: wallet.id,
          category: w.leg === 'leaderboard' ? 'leaderboard' : 'watchlist',
          score: (w.winRate30d ?? 0) * 100 + (w.pnl30d ?? 0) * 10,
          status: w.verdict === 'QUALITY' ? 'QUALIFIED_SMART_MONEY' : 'WHALE',
          pnl30d: w.pnl30d,
          winRate: w.winRate30d,
          reasons: [reason],
          classifiedAt: new Date(),
        },
        update: {
          status: w.verdict === 'QUALITY' ? 'QUALIFIED_SMART_MONEY' : 'WHALE',
          pnl30d: w.pnl30d,
          winRate: w.winRate30d,
          reasons: { push: reason },
          // Without this, the operator's "how fresh is the pool" query
          // (max(classifiedAt)) never advanced for discovered wallets —
          // verified: 3 rows persisted with classifiedAt NULL.
          classifiedAt: new Date(),
        },
      })
      written++
    } catch (err) {
      // Per-wallet failure must not abort the batch, but it MUST be visible:
      // without this warn a broken write produced "persisted 0/3" with no
      // reason anywhere in the log.
      logger.warn(
        `wallet discovery persist failed for ${w.address}: ${err instanceof Error ? err.message : String(err)}`,
        'wallet-discovery',
      )
    }
  }
  return written
}
