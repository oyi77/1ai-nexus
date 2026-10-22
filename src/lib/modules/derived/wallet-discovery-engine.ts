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
import { sortLeaderboardSurvivors } from './wallet-discovery-ranking'
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
import { loadCallConfluence, type CallConfluence } from './call-confluence'
import { loadCallFeed } from './db-call-feed'
import { fetchDexTokenMeta } from './dex-token-meta'

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
  /**
   * Min USD value a high-cap-token position must hold to count as whale
   * scale. The holder row's own `usd_value` is the measurement.
   */
  minHolderValueUsd: number
  /**
   * Holder-leg stop after this many consecutive rate-limited calls. The
   * limiter is per-account, so once it blocks us every further token costs a
   * retry storm and returns nothing — but the pass must say so instead of
   * reporting a healthy empty leg.
   */
  maxRateLimitedTokens: number
  /**
   * Explicit call groups whose mention counts as confluence. When set, the
   * harvester's own per-group weight stops deciding: the operator named the
   * groups by hand, so a weighted-out megaphone still counts. When unset the
   * weight floor does the deciding (see call-confluence).
   */
  trustedCallGroups: string[] | null
  /**
   * Origin-weighted group count a contract must reach before its holders are
   * labelled "confluence above bar". Reporting only — the tag states the
   * measured count either way, so a below-bar token is never dressed as one.
   */
  minCallGroups: number
  /**
   * Max contracts pulled straight from the call feed per pass. The feed is
   * an external write path: an unbounded list would let one busy window
   * spend the whole holder budget on the loudest shill's mint.
   */
  maxCalledTokens: number
  /**
   * Max token contracts re-read from the persisted `TokenHolding` table per
   * pass. GMGN's holders endpoint only serves pump.fun-origin mints, so an
   * established token ($1M+) can never contribute holders through the live
   * established-token leg — measured live, 35/35 tokens came back empty. The
   * holdings table already carries GMGN holder rows for those contracts
   * (written by token-holdings-persist, i.e. one measure per contract instead
   * of one per pass), so this leg replays them.
   */
  maxPersistedTokens: number
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
  minHolderValueUsd: 10_000,
  maxRateLimitedTokens: 3,
  trustedCallGroups: null,
  minCallGroups: 2,
  maxCalledTokens: 8,
  maxPersistedTokens: 10,
}
export type WalletLeg =
  | 'leaderboard'
  | 'high-cap-holders'
  | 'called-contracts'
  | 'persisted-holdings'
export type HumanVerdict = 'HUMAN' | 'BOT_FAST_TX' | 'BOT_BUY_ONLY' | 'UNKNOWN'

/**
 * Pool statuses that already carry a human proof from `classifyHuman`. A
 * replayed persisted holder is graded on this when GMGN's 30d window is
 * empty: `UNKNOWN`/`DISQUALIFIED`/`null` are NOT proofs and re-enter the
 * live check instead.
 */
const PRIOR_HUMAN_STATUSES = new Set(['WHALE', 'QUALIFIED_SMART_MONEY', 'WATCHLIST', 'PROVISIONAL'])

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
      reason: `fastTxRatio ${(fastTx * 100).toFixed(1)}% >= ${(f.maxFastTxRatio * 100).toFixed(0)}% (sniper automation, not human)`,
    }
  }
  if (sells === null) {
    // Unknown sell count is NOT a pass: the operator's mandate is to prove a
    // wallet is not a bot, and a wallet whose exits are unmeasured proves
    // nothing.
    return {
      verdict: 'UNKNOWN',
      reason: 'sell count unreported (cannot prove the wallet exits positions)',
    }
  }
  if (sells === 0) {
    return {
      verdict: 'BOT_BUY_ONLY',
      reason: `${buys} buys, 0 sells in 30d (dump-and-abandon bot pattern)`,
    }
  }
  return { verdict: 'HUMAN', reason: `fastTx ${(fastTx ?? 0).toFixed(2)}, ${buys} buys / ${sells} sells (human trading cadence)` }
}

export interface DiscoveredWallet {
  address: string
  /** Measured chain. Every leg is GMGN-`/sol/`-scoped except the leaderboard
   * sweep tagged `smart_degen`, which spans chains; persisting those as
   * solana put EVM addresses in a Solana wallet table. */
  chain: string
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
  /**
   * QUALIFIED cleared the full §5 bar and may carry a signal weight.
   * WATCHLIST is a measured, human-verified wallet that did NOT clear the
   * bar (whale-scale volume with a weak win rate, or high-cap ownership with
   * no 30d pnl quote). It is tracked for its buys, never quoted as quality.
   */
  admission: 'QUALIFIED' | 'WATCHLIST'
  /** Why it was admitted, in the operator's words. Auditable, never blank. */
  reason: string
  /**
   * Mint the wallet was holding when the holder leg found it; null for a
   * leaderboard wallet (the rank sweep proves nothing was held). This is the
   * key that joins a wallet to the call groups that flagged its token.
   */
  tokenContract: string | null
  /**
   * Call groups that flagged `tokenContract`, strongest first, with the
   * origin-weighted count the strategy gate reads. Null means the wallet is
   * not tied to a called token — either the feed never mentioned it or the
   * feed could not be read; `callGroupTag` says which.
   */
  callGroups: { groups: string[]; groupCount: number; effectiveGroupCount: number } | null
  leg: WalletLeg
  human: HumanCheck
}

/**
 * Chain of an address as GMGN measures it.
 *
 * `/rank/sol/wallets` is Solana-scoped, but a swept wallet can be measured on
 * any chain. The address shape is the only evidence available, and it is
 * exact for the case that matters: a 0x-prefixed 40-hex string is EVM and can
 * never be a base58 Solana key. Anything else stays solana, which is what
 * every other leg is scoped to.
 */
export function chainOfAddress(address: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? 'ethereum' : 'solana'
}

function establishedMc(tok: { marketCap?: number }): number | null {
  return typeof tok.marketCap === 'number' && tok.marketCap > 0 ? tok.marketCap : null
}

/**
 * Leg A — leaderboard sweep into a deduped candidate map.
 *
 * Merging is split from measuring on purpose. The free prefilter and the
 * quality-first ordering only make sense over the WHOLE merged set, and the
 * earlier version applied both inside the per-tag loop, so the tag holding
 * the best wallet decided whether it was ever measured at all.
 */
export async function collectLeaderboardCandidates(
  f: DiscoveryFilters,
): Promise<Map<string, { w: HarvestedWallet; tags: string[] }>> {
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
  return merged
}

/**
 * Leg A — measure and gate the leaderboard candidates.
 *
 * Two passes. The WHALE leg (30d buy volume ≥ $250k) is quoted on the VOLUME
 * axis, not the win-rate axis, so it must not be judged by this leg's
 * minWinRate/minPnl. A wallet between the two bars (real volume, 45% win
 * rate) is submitted as WATCHLIST with its measured numbers and a named
 * reason — refused entry, but auditable instead of silently vanishing.
 * Only wallets below BOTH bars are dropped here.
 *
 * `audit` receives every candidate that was measured and refused, so the
 * caller can log WHY. Without it a pass reports one aggregate `filters: 134`
 * that cannot be reconciled against its own leaderboard count.
 */
export async function measureLeaderboard(
  f: DiscoveryFilters,
  merged: Map<string, { w: HarvestedWallet; tags: string[] }>,
  audit: { refused: Array<{ address: string; reason: string }> },
): Promise<DiscoveredWallet[]> {
  // Prefilter BEFORE spending a stats call: leaderboard rows already carry
  // winRate30d/pnl30d/buyVolume30d, so most wallets are rejected for free.
  // This matters because GMGN's limiter allows 60 requests per minute —
  // measuring all ~413 merged wallets needed ~7 minutes and made the pass
  // look hung (live: killed at 260s and 300s with only "start" printed).
  const survivors: Array<[string, { w: HarvestedWallet; tags: string[] }]> = []
  for (const entry of merged.entries()) {
    const verdict = verifyWhaleForList({
      winRate30d: entry[1].w.winRate30d,
      pnl30d: entry[1].w.pnl30d,
      buyVolume30d: entry[1].w.buyVolume30d,
    })
    if (verdict.include) survivors.push(entry)
  }

  const toMeasure = sortLeaderboardSurvivors(survivors, f.minWinRate, f.minPnl).slice(
    0,
    f.maxStatMeasurements,
  )
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
    // Only the QUALITY bar can be judged without the volume leg; the WHALE
    // leg is still admissible (the verifier already accepted it pre-measure).
    const belowQuality = (w.winRate30d ?? 0) < f.minWinRate || (w.pnl30d ?? 0) < f.minPnl
    if (belowQuality) {
      const volume = w.buyVolume30d ?? 0
      if (volume < f.minBuyVolumeUsd) {
        audit.refused.push({
          address,
          reason: `below both bars (wr ${((w.winRate30d ?? 0) * 100).toFixed(0)}% < ${(f.minWinRate * 100).toFixed(0)}%, pnl ${((w.pnl30d ?? 0) * 100).toFixed(0)}% < ${(f.minPnl * 100).toFixed(0)}%, vol $${Math.round(volume).toLocaleString('en-US')} < $${f.minBuyVolumeUsd.toLocaleString('en-US')})`,
        })
        continue
      }
      if (human.verdict !== 'HUMAN') {
        audit.refused.push({ address, reason: `bot check refused: ${human.reason}` })
        continue
      }
      out.push({
        chain: chainOfAddress(address),
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
        verdict: null,
        admission: 'WATCHLIST',
        reason: `whale-scale volume but below the quality bar (wr ${((w.winRate30d ?? 0) * 100).toFixed(0)}%, pnl ${((w.pnl30d ?? 0) * 100).toFixed(0)}%)`,
        tokenContract: null,
        callGroups: null,
        leg: 'leaderboard',
        human,
      })
      continue
    }
    const verdict = verifyWhaleForList({
      winRate30d: w.winRate30d,
      pnl30d: w.pnl30d,
      buyVolume30d: w.buyVolume30d,
    })
    if (!verdict.include) {
      audit.refused.push({ address, reason: verdict.reason })
      continue
    }
    if (human.verdict !== 'HUMAN') {
      audit.refused.push({ address, reason: `bot check refused: ${human.reason}` })
      continue
    }
    out.push({
      chain: chainOfAddress(address),
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
      admission: 'QUALIFIED',
      reason: verdict.reason,
      tokenContract: null,
      callGroups: null,
      leg: 'leaderboard',
      human,
    })
  }
  return out
}

async function sweepLeaderboard(
  f: DiscoveryFilters,
  audit: { refused: Array<{ address: string; reason: string }> },
): Promise<DiscoveredWallet[]> {
  const merged = await collectLeaderboardCandidates(f)
  return measureLeaderboard(f, merged, audit)
}

export interface HolderCandidate {
  address: string
  source: string
  /** Contract of the high-cap token that put this wallet in the list. */
  tokenContract: string
  /** USD mark-to-market of the position that put this wallet in the list. */
  valueUsd: number | null
  pctOfSupply: number | null
  /** True when GMGN flags the address itself (bundler / sniper / fresh). */
  flagged: boolean
  /** GMGN's tags on the holder row (`transfer_in`, `fomo`, `whale`, ...). */
  tags: string[]
  /** Which discovery source produced this candidate. The admission evidence
   * differs: a $1M+ established-token position is size on its own, while a
   * called-mint position is size only when its USD mark clears the floor. */
  leg: WalletLeg
  /** Status this wallet already holds in `SmartMoneyWallet`. Discovery replays
   * persisted rows, so the wallet may have been proved human on an earlier
   * pass; re-asking GMGN for 30d activity cannot re-prove it. */
  priorStatus?: string | null
}

/**
 * The one-line provenance every holder admission carries.
 *
 * Sizing rules differ by leg and the difference is the point: a high-cap
 * holder is sized by the position that put it in the list (and says so when
 * the mark is unmeasured), while a called-mint holder has already cleared
 * the USD floor before reaching here.
 *
 * The group tag is the operator's "tag which group called each CA". An
 * unreadable feed is reported as unreadable, never as "nobody called it":
 * the two facts need opposite fixes, so they never share a label.
 */
export function buildHolderReason(c: HolderCandidate, conf: CallConfluence | undefined): string {
  const size =
    c.leg === 'called-contracts'
      ? `$${Math.round(c.valueUsd ?? 0).toLocaleString('en-US')} of a group-called token`
      : c.valueUsd !== null
        ? `$${Math.round(c.valueUsd).toLocaleString('en-US')} of a $1M+ token`
        : 'size unmeasured'
  const callerTag =
    c.leg !== 'called-contracts'
      ? null
      : conf && conf.present
        ? `called by ${conf.groupCount} group(s) / ${conf.effectiveGroupCount.toFixed(2)} effective: ` +
          conf.groups.slice(0, 3).join(', ')
        : conf && conf.available
          ? 'call feed readable but this contract is no longer in it'
          : 'call feed unreadable - group tag unknown'
  const legLabel =
    c.leg === 'called-contracts'
      ? 'called-token holder'
      : c.leg === 'persisted-holdings'
        ? 'persisted-holding holder'
        : 'high-cap holder'
  return (
    `${legLabel} ` +
    `(${c.tags.length > 0 ? c.tags.join('/') : 'untagged'}): holds ${size}` +
    (callerTag ? `; ${callerTag}` : '')
  )
}


/**
 * Counters for the holder leg. `missing`/`underFloor`/`bestUsd` describe why
 * called-mint holders were refused: without them a leg whose every candidate
 * was under the size floor reports as "0 admitted", which reads exactly like
 * "the feed named nothing".
 */
interface HolderLegAudit {
  refused: Array<{ address: string; reason: string }>
  marksPicked: number
  missing: number
  underFloor: number
  bestUsd: number
  admitted: number
  /** Called-mint holders whose stats call returned (measured past the floor). */
  measured: number
  /** Holders the called-mint sweep produced before any grading. */
  candidates: number
  /** Feed contracts the called-mint sweep was asked to read. */
  contracts: number
}

/** Why the called-mint leg admitted what it did; reported with the sweep. */
export interface HolderLegCounters {
  /** Feed contracts the leg was asked to read. */
  contracts: number
  /** Holders swept before grading. */
  candidates: number
  /** Holders admitted (measured mark over the size floor, HUMAN). */
  admitted: number
  /** Of `admitted`, how many had a stats call return (so pnl/win-rate measured). */
  measured: number
  /** Holders refused for a measured mark below the floor. */
  underFloor: number
  /** Holders refused because their position value was unmeasured. */
  missing: number
  /** Largest measured position seen, USD (0 when none was measured). */
  bestUsd: number
  ms: number
}

/**
 * Provenance for the call-group join, reported even when nothing matched:
 * `feedAvailable:true` with `tokensMatched:0` says the groups we trust never
 * called these tokens, while `feedAvailable:false` says the join never ran.
 * The two need opposite fixes, so they never share a number.
 *
 * The group counts come from the SAME `CallConfluence` the strategy gate
 * reads, so a wallet tagged "4 groups called it" cannot disagree with the
 * alert that later requires 3.
 */
export interface CallGroupsReport {
  feedAvailable: boolean
  /** Contracts the holder leg asked the feed about. */
  tokensQueried: number
  /** Contracts at least one group called. */
  tokensMatched: number
  /** Contracts that cleared `minCallGroups` on the weighted basis. */
  tokensAboveBar: number
  /** Origin-weighted group count across matched contracts. */
  effectiveGroups: number
  /** Group names seen across matched contracts, strongest first. */
  groupsSeen: string[]
}

export function emptyCallGroups(): CallGroupsReport {
  return {
    feedAvailable: false,
    tokensQueried: 0,
    tokensMatched: 0,
    tokensAboveBar: 0,
    effectiveGroups: 0,
    groupsSeen: [],
  }
}

/**
 * Folds one feed read into the report. Runs inside the leg because the
 * contracts are only known once holders survive the ownership filters —
 * asking about tokens whose holders we then reject would report confluence
 * nobody consumed.
 */
export function readGroups(
  report: CallGroupsReport,
  contracts: string[],
  byContract: Map<string, CallConfluence>,
  minCallGroups: number,
): void {
  report.tokensQueried = contracts.length
  const groups = new Set<string>()
  let effective = 0
  for (const contract of contracts) {
    const match = byContract.get(contract)
    if (!match || !match.present) continue
    report.tokensMatched++
    effective += match.effectiveGroupCount
    if (match.effectiveGroupCount >= minCallGroups) report.tokensAboveBar++
    for (const g of match.groups) groups.add(g)
  }
  report.feedAvailable = contracts.length > 0 && byContract.get(contracts[0])?.available === true
  report.effectiveGroups = Number(effective.toFixed(4))
  report.groupsSeen = [...groups]
}

/**
 * Leg B — collect high-cap holders.
 *
 * The high-cap leg was structurally empty: it graded holders on
 * `stats.pnl30d > 0`, and `fetchGmgnWalletStats` (`/smartmoney/sol/wallet/`)
 * does not report pnl_30d at all — so every holder that survived the bot
 * check was then dropped on a measurement the endpoint never makes. Live:
 * 26 holders swept, 26 refused as "no measurement".
 *
 * Ownership of a $1M+ token measured in USD is the evidence this leg
 * actually has, so that is the gate: `minHolderValueUsd` (a wallet holding
 * less than $10k of a high-cap token is not whale-scale). The bot check
 * stays mandatory, and a holder that fails it is reported, not swallowed.
 */
async function sweepHighCapHolders(
  f: DiscoveryFilters,
  audit: HolderLegAudit,
  callGroups: CallGroupsReport,
): Promise<{
  wallets: DiscoveredWallet[]
  called: HolderLegCounters
  persisted: HolderLegCounters
  highCapAdmitted: number
}> {
  // maxTokens budgets SOLANA tokens (every leg below is Solana-scoped), so ask
  // for a multiple: the established feed interleaves every GMGN chain, and the
  // live pass took 12 tokens of which 8 were EVM and had to be discarded.
  const tokens = await discoverEstablishedGmgnTokens(f.maxTokens * 4, {
    minVolumeUsd: 100_000,
    minAgeHours: 24,
  })

  // Gather candidates first; measuring 100+ holders per token sequentially
  // was the reason a pass could not finish inside its window.
  const candidates: HolderCandidate[] = []
  const seen = new Set<string>()
  let emptyHolderTokens = 0
  let rateLimitedTokens = 0
  const stopAt = Date.now() + f.budgetMs
  for (const tok of tokens) {
    if (Date.now() > stopAt) break
    const mc = establishedMc(tok)
    if (mc === null || mc < f.minEstablishedMc) continue
    // Every leg below is GMGN `/sol/`-scoped: the holders list, the per-wallet
    // stats and the leaderboard are all Solana. discoverEstablishedGmgnTokens
    // spans every GMGN chain, so an EVM token here sent its 0x contract to the
    // solana holders endpoint (live: 2 chain-wide 5-attempt failures), and any
    // EVM holder that did return would have been persisted as a Solana wallet.
    if (tok.chain !== 'solana') continue
    let holders: Awaited<ReturnType<typeof listGmgnTokenHolders>> = []
    try {
      // GMGN's holders endpoint only returns rows for pump.fun-origin mints;
      // established tokens (pPOLY/XDP/QQQB measured live) come back EMPTY after
      // a ~6.5s retry, and every keyless alternative failed (Solscan 403/DNS,
      // RugCheck 400 on report/summary). Skip after the first empty response
      // per token rather than burning the whole budget on dead calls.
      holders = await listGmgnTokenHolders('solana', tok.contract)
    } catch (err) {
      // A 429 is NOT "this token has no holders": the leg measured nothing,
      // and reporting it as an empty token made a fully rate-limited pass
      // indistinguishable from a pass over tokens with no ownership data
      // (live: 12/12 holder calls 429, leg reported 0 accepted and 0 refused).
      // Count it, and stop the leg once the limiter is clearly blocking us.
      rateLimitedTokens++
      audit.refused.push({
        address: tok.contract,
        reason: `unreachable: holder list rate limited (${String(err).slice(0, 80)})`,
      })
      if (rateLimitedTokens >= f.maxRateLimitedTokens) break
      continue
    }
    if (holders.length === 0) {
      emptyHolderTokens++
      if (emptyHolderTokens >= f.maxEmptyHolderTokens) break
      continue
    }
    // The holder row carries the position's own mark-to-market, so no supply
    // arithmetic and no extra request are needed to size the wallet.
    for (const h of holders.slice(0, f.maxHoldersPerToken)) {
      const address = typeof h.address === 'string' && h.address.length > 20 ? h.address : null
      if (!address || seen.has(address)) continue
      seen.add(address)
      const usd = typeof h.usdValue === 'number' && h.usdValue > 0 ? h.usdValue : null
      candidates.push({
        address,
        source: `gmgn-holder:${tok.contract.slice(0, 6)}`,
        tokenContract: tok.contract,
        valueUsd: usd,
        flagged: h.suspicious === true,
        tags: h.tags,
        pctOfSupply: typeof h.amountPercentage === 'number' ? h.amountPercentage : null,
        leg: 'high-cap-holders',
      })
    }
  }

  // Grade on ownership BEFORE spending a stats call: the position size is
  // already measured, the bot check is the only thing that needs a request.
  // GMGN's own address flags (bundler / fresh_wallet / sniper on the row) are
  // a refusal in their own right: a wallet that looks like a whale only
  // because it bundled the launch is not a whale, and `suspicious` must not
  // be silently dropped on the way into the candidate list.
  const holdersOfScale = candidates.filter((c) => {
    if (c.flagged) {
      audit.refused.push({
        address: c.address,
        reason: 'GMGN flagged the address (bundler / sniper / fresh wallet) - not a tracked human whale',
      })
      return false
    }
    // A holder whose position arrived by transfer never bought this token, so
    // the row proves custody, not conviction: tracking it as a whale would be
    // a claim about buying behaviour the evidence does not contain. Live:
    // ZEC's top-3 rows and STONK's top row are all `transfer_in`.
    if (c.tags.includes('transfer_in')) {
      audit.refused.push({
        address: c.address,
        reason: 'holder received the position by transfer (never bought) - custody, not conviction',
      })
      return false
    }
    if (c.valueUsd !== null) return c.valueUsd >= f.minHolderValueUsd
    audit.marksPicked++
    return true
  })
  // The operator's "tag which group called each CA" join, at its cheapest
  // point: ONE feed read for the whole leg, keyed by the contracts the
  // surviving holders actually own.
  const heldContracts = [...new Set(holdersOfScale.map((c) => c.tokenContract))]
  const confluence = await loadCallConfluence(heldContracts, { trustedGroups: f.trustedCallGroups ?? [] })
  // Queried-only above meant the join could never fire: measured live, the
  // contracts 12 call groups shout about (pump.fun mints, ~$70k mc) and the
  // contracts this leg inspects ($1M+ established tokens) were DISJOINT
  // sets — queried=15 matched=0 on a healthy feed. Group-call propagation is
  // what the operator asked to capture, so the called contracts are pulled by
  // contract id (chain-scoped, no market-cap gate) and their holders swept
  // too. The admission bar is unchanged: a called-token holder still needs a
  // measured USD position over the floor, a 30d pnl/win-rate measurement, and
  // a HUMAN verdict, so a thin-liquidity shill cannot enter the pool on the
  // strength of the call alone.
  const feedRead = await loadCallFeed().catch(() => null)
  const feedMints = (feedRead?.readOk ? feedRead.rows : [])
    .filter((r) => r.chain === 'solana' || r.chain === '')
    .map((r) => r.contract)
    .filter((c) => !heldContracts.includes(c))
  // Rank BEFORE spending the holder budget. The feed is dominated by
  // single-shill mints (live: 44 candidates, 12 carry two or more groups),
  // so slicing the raw list spends the whole leg on whoever shilled loudest
  // last. Confluence is the operator's own admission signal; contract id is
  // only the tie-break so the order is stable between passes.
  const feedConf = await loadCallConfluence(feedMints, { trustedGroups: f.trustedCallGroups ?? [] })
  const rankOf = (contract: string): number => {
    const c = feedConf.get(contract)
    return c && c.available && c.present ? c.effectiveGroupCount : 0
  }
  const calledContracts = [...feedMints]
    .sort((a, b) => rankOf(b) - rankOf(a) || a.localeCompare(b))
    .slice(0, f.maxCalledTokens)
  // The feed's LIVE contracts are all pump.fun-origin, and that is exactly the
  // shape GMGN's holder endpoint serves — while the established-token leg just
  // spent `maxEmptyHolderTokens` empty responses on mints it can never read.
  // Passing that budget in as spent would skip every called mint unmeasured,
  // so this leg starts from zero: its contracts are known-servable by
  // construction, and the two legs must not share a stop condition that only
  // one of them can hit.
  const calledAudit: HolderLegAudit = {
    refused: audit.refused,
    marksPicked: 0,
    missing: 0,
    underFloor: 0,
    bestUsd: 0,
    admitted: 0,
    measured: 0,
    candidates: 0,
    contracts: calledContracts.length,
  }
  const tC = Date.now()
  const calledHolders = await collectCalledHolders(calledContracts, f, calledAudit, calledContracts.length)
  const cMs = Date.now() - tC
  calledAudit.candidates = calledHolders.length
  if (calledContracts.length > 0) {
    // `confluence` is the holder leg's lookup; the feed-wide map is already
    // keyed by the same contracts, so it is reused rather than re-read.
    for (const [contract, conf] of feedConf) {
      if (calledContracts.includes(contract) && !confluence.has(contract)) confluence.set(contract, conf)
    }
    const calledConf = new Map<string, CallConfluence>()
    for (const c of calledContracts) {
      const conf = feedConf.get(c)
      if (conf) calledConf.set(c, conf)
    }
    readGroups(callGroups, calledContracts, calledConf, f.minCallGroups)
  }
  // Leg B2 — persisted holdings of established tokens. The live established
  // leg above cannot produce holders: GMGN serves the holders endpoint only
  // for pump.fun-origin mints, so every $1M+ token came back empty (live:
  // 35 tokens admitted from that leg were all leaderboard-sourced). The
  // `TokenHolding` table already holds GMGN holder rows for established
  // contracts, written once per contract by token-holdings-persist, so the
  // evidence is replayed here instead of re-requested. Rows are upserted on
  // every pass, so "persisted" means measured, never stale-by-construction —
  // and the refused/floor rules below are the same ones the live leg uses.
  const tP = Date.now()
  const persisted = await sweepPersistedHoldings(f, audit)
  const pMs = Date.now() - tP
  const measured = [...holdersOfScale, ...calledHolders, ...persisted.holders]
  const statsList = await mapLimit(
    measured,
    f.concurrency,
    (c) => fetchGmgnWalletStats(c.address).catch(() => null),
    f.budgetMs,
  )
  const out: DiscoveredWallet[] = []

  for (let i = 0; i < measured.length; i++) {
    const c = measured[i]
    // Both holder legs admit on ownership alone, so the USD floor is applied
    // here for both. Measured live for the called leg: the counters read
    // 0/0/0 because nothing ever incremented them, which made "every called
    // holder was dust" indistinguishable from "the leg was never asked".
    const sized = c.leg === 'called-contracts' || c.leg === 'persisted-holdings'
    // `bestUsd` is reported separately per leg below: one shared high-water
    // mark let a called-contract dust row ($441k) mask the persisted leg's
    // real scale, and only the called leg ever received the value.
    const legBest = c.leg === 'persisted-holdings' ? persisted : calledAudit
    if (sized) {
      const counter = c.leg === 'called-contracts' ? calledAudit : persisted
      if (c.valueUsd === null) {
        counter.missing++
        audit.refused.push({
          address: c.address,
          reason: `holder position unmeasured - cannot prove $${Math.round(f.minHolderValueUsd).toLocaleString('en-US')} scale`,
        })
        continue
      }
      if (c.valueUsd !== null) legBest.bestUsd = Math.max(legBest.bestUsd, c.valueUsd)
      if (c.valueUsd < f.minHolderValueUsd) {
        counter.underFloor++
        audit.refused.push({
          address: c.address,
          reason:
            `holder position $${Math.round(c.valueUsd).toLocaleString('en-US')} ` +
            `(BELOW $${Math.round(f.minHolderValueUsd).toLocaleString('en-US')} floor)`,
        })
        continue
      }
    }
    const stats = statsList[i]
    // A replayed row may belong to a wallet this pipeline already proved
    // human on an earlier pass. GMGN's per-wallet stats only cover recent 30d
    // activity, so a real whale that simply did not trade in that window
    // returns 0/0 and would be refused forever — the leg then re-measures the
    // same 103 wallets every pass and can never admit one (measured live:
    // 0 admitted across three passes). Recorded evidence is the only evidence
    // available for these wallets, and it is the same bar (status set by
    // `classifyHuman`), so it is used — and labelled as such.
    const prior = c.priorStatus ?? null
    const proven = PRIOR_HUMAN_STATUSES.has(prior ?? '')
    let human: HumanCheck
    if (proven) {
      human = {
        verdict: 'HUMAN',
        reason: `human verified on an earlier pass (${prior} in the tracked pool)`,
      }
    } else if (stats === null || (stats.buyCount30d === 0 && stats.sellCount30d === 0)) {
      // Holder rows also exist for wallets whose GMGN activity is empty or
      // unreportable. Those are not bots (measured live: $20M-scale holders
      // with 0 buys / 0 sells), but they cannot be PROVEN human either — so
      // they leave as an unreachable measurement, not as a bot refusal.
      audit.refused.push({
        address: c.address,
        reason:
          stats === null
            ? 'no measurement: GMGN wallet stats unavailable'
            : 'no measurement: GMGN reports zero 30d activity - cannot prove human',
      })
      continue
    } else {
      human = classifyHuman(
        {
          fastTxRatio: stats.fastTxRatio ?? null,
          buyCount30d: stats.buyCount30d ?? null,
          sellCount30d: stats.sellCount30d ?? null,
        },
        f,
      )
      if (human.verdict !== 'HUMAN') {
        audit.refused.push({ address: c.address, reason: `bot check refused: ${human.reason}` })
        continue
      }
    }
    const counter = c.leg === 'called-contracts' ? calledAudit : c.leg === 'persisted-holdings' ? persisted : null
    if (counter) counter.admitted++
    if (counter && stats !== null) counter.measured++
    const conf = confluence.get(c.tokenContract)
    out.push({
      chain: chainOfAddress(c.address),
      address: c.address,
      name: null,
      source: c.source,
      winRate30d: null,
      pnl30d: stats?.pnl30d ?? null,
      realizedProfit30d: stats?.realizedProfit30d ?? null,
      buyVolume30d: null,
      buyCount30d: stats?.buyCount30d ?? null,
      sellCount30d: stats?.sellCount30d ?? null,
      tags: [...new Set([...(stats?.tags ?? []), ...c.tags])],
      verdict: null,
      admission: 'WATCHLIST',
      reason: buildHolderReason(c, conf),
      tokenContract: c.tokenContract,
      callGroups:
        conf && conf.available && conf.present
          ? {
              groups: conf.groups,
              groupCount: conf.groupCount,
              effectiveGroupCount: conf.effectiveGroupCount,
            }
          : null,
      leg: c.leg,
      human,
    })
  }
  // No shared high-water mark: each leg reports its own `bestUsd`, so a dust
  // called-contract row can no longer stand in for the persisted leg's scale.
  return {
    wallets: out,
    called: {
      contracts: calledAudit.contracts,
      candidates: calledAudit.candidates,
      admitted: calledAudit.admitted,
      measured: calledAudit.measured,
      underFloor: calledAudit.underFloor,
      missing: calledAudit.missing,
      bestUsd: calledAudit.bestUsd,
      ms: cMs,
    },
    persisted: {
      contracts: persisted.contracts,
      candidates: persisted.candidates,
      admitted: persisted.admitted,
      measured: persisted.measured,
      underFloor: persisted.underFloor,
      missing: persisted.missing,
      bestUsd: persisted.bestUsd,
      ms: pMs,
    },
    // The high-cap holders are inside `out` too, so the caller splits them by
    // tag rather than re-deriving them from a second list.
    highCapAdmitted: out.filter((w) => w.leg === 'high-cap-holders').length,
  }
}

/**
 * Holders of contracts a call group flagged THIS feed window.
 *
 * Distinct from `sweepHighCapHolders` in every input that matters: the
 * contracts come from the feed (by id, no market-cap gate), they are
 * pump.fun mints on the whole, and there are few of them. Same ownership
 * refusals apply — a flagged address or a `transfer_in` position is custody,
 * not conviction. Size is NOT graded here: the caller grades it against
 * `minHolderValueUsd` once, for both sources, so a called mint cannot slip
 * past the floor through a second code path.
 */
async function collectCalledHolders(
  contracts: string[],
  f: DiscoveryFilters,
  audit: HolderLegAudit,
  feedSize: number,
): Promise<HolderCandidate[]> {
  // Proportional, not the established leg's absolute 2: `maxCalledTokens` is 8,
  // so an absolute cap of 2 would abandon the sixth shilled mint even while
  // every earlier one returned real holders. Half the window is the tolerance.
  const emptyLimit = Math.max(2, Math.ceil(feedSize / 2))
  const out: HolderCandidate[] = []
  const seen = new Set<string>()
  let empty = 0
  let rateLimited = 0
  const stopAt = Date.now() + f.budgetMs
  for (const contract of contracts) {
    if (Date.now() > stopAt) break
    let holders: Awaited<ReturnType<typeof listGmgnTokenHolders>> = []
    try {
      holders = await listGmgnTokenHolders('solana', contract)
    } catch (err) {
      rateLimited++
      audit.refused.push({
        address: contract,
        reason: `unreachable: called-token holder list rate limited (${String(err).slice(0, 80)})`,
      })
      if (rateLimited >= f.maxRateLimitedTokens) break
      continue
    }
    if (holders.length === 0) {
      empty++
      if (empty >= emptyLimit) break
      continue
    }
    const before = out.length
    for (const h of holders.slice(0, f.maxHoldersPerToken)) {
      const address = typeof h.address === 'string' && h.address.length > 20 ? h.address : null
      if (!address || seen.has(address)) continue
      if (h.suspicious === true) {
        audit.refused.push({
          address,
          reason: 'GMGN flagged the address (bundler / sniper / fresh wallet) - not a tracked human whale',
        })
        continue
      }
      if (h.tags.includes('transfer_in')) {
        audit.refused.push({
          address,
          reason: 'holder received the position by transfer (never bought) - custody, not conviction',
        })
        continue
      }
      seen.add(address)
      out.push({
        address,
        source: `call-feed:${contract.slice(0, 6)}`,
        tokenContract: contract,
        valueUsd: typeof h.usdValue === 'number' && h.usdValue > 0 ? h.usdValue : null,
        flagged: false,
        tags: h.tags,
        pctOfSupply: typeof h.amountPercentage === 'number' ? h.amountPercentage : null,
        leg: 'called-contracts',
      })
      // Size and the bot check are graded once, by the caller, for both
      // holder sources. Counting here would report a wallet as admitted
      // before either rule ran.
    }
    logger.info(
      `called-holders ${contract.slice(0, 8)}… rows=${holders.length} accepted=${out.length - before}`,
      'wallet-discovery',
    )
  }
  return out
}
interface PersistedHoldings {
  holders: HolderCandidate[]
  contracts: number
  candidates: number
  admitted: number
  measured: number
  underFloor: number
  missing: number
  bestUsd: number
}

/**
 * Leg B2 — replay the holder rows already persisted for established tokens.
 *
 * The live established leg is structurally empty: GMGN's `/holders` endpoint
 * serves pump.fun-origin mints only, so every $1M+ token it was given came
 * back with zero rows (live: 35 established tokens, 0 holders, 0 admissions).
 * `token-holdings-persist` writes those same rows for established contracts
 * through the same endpoint, so the table holds the closest thing to a
 * measured position list this repo has — and it is re-upserted, not frozen.
 *
 * Two rules keep the replay honest:
 *   · a token whose metadata is a PLACEHOLDER row (symbol = address prefix,
 *     marketCap 0) is not established evidence and is skipped, the same way
 *     `loadMarkets` treats it as absent;
 *   · a token is kept only when DexScreener confirms market cap >=
 *     `minEstablishedMc` — the leg is defined by token scale, not by the
 *     Token row's possibly-never-populated marketCap column.
 *
 * Positions reuse `minHolderValueUsd` only when the row carries a real USD
 * mark; a zero mark stays zero and is refused downstream as unmeasured
 * rather than being inflated from a guessed supply.
 */
async function sweepPersistedHoldings(
  f: DiscoveryFilters,
  audit: HolderLegAudit,
): Promise<PersistedHoldings> {
  const out: PersistedHoldings = {
    holders: [],
    contracts: 0,
    candidates: 0,
    admitted: 0,
    measured: 0,
    underFloor: 0,
    missing: 0,
    bestUsd: 0,
  }
  // Token selection happens BEFORE any slice. Ordering the groupBy so the
  // real-cap contracts win is impossible: `Token.marketCap` defaults to 0 and
  // the placeholder rows are all that table holds, while the seeding rows
  // (ETH/BTC/SOL) carry a $2T fake cap on an EVM address. Taking the top N by
  // summed holdings therefore picked ten contracts whose only persisted rows
  // were the placeholders themselves — market cap unknown, leg empty (live:
  // 0 of 0 established contracts). The honest order is: every contract that
  // has holdings, resolve its REAL cap from DexScreener, keep the ones over
  // `minEstablishedMc`, then take the top `maxPersistedTokens` of those.
  const grouped = await prisma.tokenHolding
    .groupBy({
      by: ['tokenId'],
      _sum: { usdValue: true },
      orderBy: { _sum: { usdValue: 'desc' } },
    })
    .catch((err: unknown) => {
      audit.refused.push({
        address: 'token-holding',
        reason: `unreachable: persisted holdings unreadable (${String(err).slice(0, 80)})`,
      })
      return []
    })
  if (grouped.length === 0) return out
  const tokens = await prisma.token.findMany({
    where: { id: { in: grouped.map((r) => r.tokenId) }, chain: 'solana' },
    select: { id: true, address: true, chain: true },
  })
  const meta = await fetchDexTokenMeta(tokens.map((t) => t.address))
  const capById = new Map<string, number>()
  for (const t of tokens) {
    const mc = meta.get(t.address)?.marketCapUsd
    if (typeof mc === 'number' && mc >= f.minEstablishedMc) capById.set(t.id, mc)
  }
  if (capById.size === 0) return out
  const established = new Map<string, string>()
  for (const t of tokens) {
    if (!capById.has(t.id)) continue
    if (established.size >= f.maxPersistedTokens) break
    established.set(t.id, t.address)
  }
  if (established.size === 0) return out
  out.contracts = established.size
  const holdings = await prisma.tokenHolding
    .findMany({
      where: { tokenId: { in: [...established.keys()] } },
      orderBy: { usdValue: 'desc' },
      take: established.size * f.maxHoldersPerToken,
      select: {
        usdValue: true,
        tokenId: true,
        wallet: {
          select: { address: true, labels: true, smartMoneyWallet: { select: { status: true } } },
        },
      },
    })
    .catch((err: unknown) => {
      audit.refused.push({
        address: 'token-holding',
        reason: `unreachable: persisted holder rows unreadable (${String(err).slice(0, 80)})`,
      })
      return []
    })
  const seen = new Set<string>()
  for (const h of holdings) {
    const address = h.wallet?.address
    const contract = established.get(h.tokenId)
    if (!contract || typeof address !== 'string' || address.length < 20) continue
    if (seen.has(address)) continue
    seen.add(address)
    out.holders.push({
      address,
      source: `holding:${contract.slice(0, 6)}`,
      tokenContract: contract,
      valueUsd: typeof h.usdValue === 'number' && h.usdValue > 0 ? h.usdValue : null,
      flagged: false,
      tags: h.wallet.labels,
      pctOfSupply: null,
      leg: 'persisted-holdings',
      priorStatus: h.wallet?.smartMoneyWallet?.status ?? null,
    })
  }
  out.candidates = out.holders.length
  return out
}

export interface DiscoveryResult {
  discovered: DiscoveredWallet[]

  /** Refusals that happened BEFORE any measurement (unreachable token, no
   * holder rows, dead rank call). Measured-and-refused passes are in
   * `refusals`, each with the address and the rule that failed. */
  refused: { noMeasure: number; bot: number; filters: number }
  /** Filter rejections bucketed by the rule that failed, each summarised as
   * `'<count>x (worst <pct>%, best <pct>%)'`, e.g. `{'pnl+wr': '91x (worst
   * 1%, best 55%)'}`. Bucketing by rule (not by measured value) keeps the log
   * readable: per-wallet keys fragmented 133 refusals into ~100 buckets. */
  filterReasons: Record<string, string>
  /** Every measured wallet that did not enter the pool, with its reason. */
  refusals: Array<{ address: string; reason: string }>
  /** Wallets the leaderboard leg admitted (WHALE / QUALIFIED / WATCHLIST). */
  leaderboardLeg: number
  /** Holders of $1M+ established tokens admitted by the holder sweep. */
  highCapLeg: number
  /** Holders of call-feed contracts admitted (sized over the USD floor, HUMAN). */
  calledContractLeg: number
  /** Holders replayed from the persisted TokenHolding rows of $1M+ tokens
   * (sized over the USD floor, HUMAN). Owned by its own leg because the live
   * established leg cannot return holders at all. */
  persistedHoldingLeg: number
  /** Call-group join outcome for the holder leg; see CallGroupsReport. */
  callGroups: CallGroupsReport
}

/**
 * Full pass. Deterministic given the same upstream data; every refusal
 * is counted and the reason class named, so the operator can audit
 * exactly why a wallet did NOT enter the pool.
 *
 * Each leg returns only wallets it has already judged (bar + mandatory bot
 * check), so this function merges — it does not re-judge. The earlier
 * version re-applied `winRate30d !== null` HERE and silently discarded the
 * entire high-cap holder leg, whose rows have no 30d win rate by
 * construction (the holders endpoint reports ownership, not a track record).
 */
export async function runWalletDiscovery(
  overrides: Partial<DiscoveryFilters> = {},
  paceMs = 400,
): Promise<DiscoveryResult> {
  const f = { ...DISCOVERY_DEFAULTS, ...overrides }
  const refused = { noMeasure: 0, bot: 0, filters: 0 }
  const refusals: Array<{ address: string; reason: string }> = []
  const leaderboardAudit = { refused: [] as Array<{ address: string; reason: string }>, marksPicked: 0 }
  const holderAudit: HolderLegAudit = {
    refused: [],
    marksPicked: 0,
    missing: 0,
    underFloor: 0,
    bestUsd: 0,
    admitted: 0,
    measured: 0,
    candidates: 0,
    contracts: 0,
  }
  const legAudit = { marksPicked: 0 }
  const callGroups = emptyCallGroups()
  const filterBuckets = new Map<string, { n: number; min: number; max: number }>()
  const noteFilter = (w: DiscoveredWallet): void => {
    const wr = w.winRate30d ?? 0
    const pnl = w.pnl30d ?? 0
    const rules: string[] = []
    if (pnl < f.minPnl) rules.push('pnl')
    if (wr < f.minWinRate) rules.push('wr')
    const key = rules.length === 0 ? 'unexplained' : rules.join('+')
    const worst = Math.min(pnl, wr)
    const prev = filterBuckets.get(key)
    filterBuckets.set(key, {
      n: (prev?.n ?? 0) + 1,
      min: Math.min(prev?.min ?? worst, worst),
      max: Math.max(prev?.max ?? worst, worst),
    })
  }
  // Counted AFTER both legs run: `refusals` is the very array the legs push
  // into, so counting it before the sweeps would always report zero.

  // Stage timings are permanent: a pass that appeared to "hang" was really
  // spending minutes in one leg, and without these stamps that was invisible
  // in the cron log (only the start line printed).
  const tA = Date.now()
  const leaderboard = await sweepLeaderboard(f, leaderboardAudit)
  const aMs = Date.now() - tA
  await new Promise((r) => setTimeout(r, paceMs))
  const tB = Date.now()
  const holderSweep = await sweepHighCapHolders(f, holderAudit, callGroups)
  const highCap = holderSweep.wallets
  const bMs = Date.now() - tB

  for (const w of leaderboard) if (w.admission === 'WATCHLIST') noteFilter(w)
  refusals.push(...leaderboardAudit.refused, ...holderAudit.refused)
  legAudit.marksPicked = leaderboardAudit.marksPicked + holderAudit.marksPicked
  // Refusals are attributed by the leg that made them, not by string
  // matching: `noMeasure` must mean "we could not measure", and a leg that
  // refuses on measured evidence (GMGN flags, holder floor) is a filter.
  for (const r of leaderboardAudit.refused) {
    if (r.reason.startsWith('bot check refused')) refused.bot++
    else refused.filters++
  }
  for (const r of holderAudit.refused) {
    if (r.reason.startsWith('bot check refused')) refused.bot++
    else if (r.reason.startsWith('unreachable') || r.reason.startsWith('no measurement')) refused.noMeasure++
    else refused.filters++
  }
  logger.info(
    `wallet discovery legs: leaderboard=${leaderboard.length} in ${aMs}ms, ` +
      `highCapHolders=${holderSweep.highCapAdmitted} admitted of ${holderSweep.wallets.length - holderSweep.called.admitted - holderSweep.persisted.admitted} graded in ${bMs}ms, ` +
      `calledHolders=${holderSweep.called.admitted} of ${holderSweep.called.candidates} swept ` +
      `from ${holderSweep.called.contracts} feed contract(s) ` +
      `(underFloor=${holderSweep.called.underFloor} noMark=${holderSweep.called.missing} ` +
      `bestMark=$${Math.round(holderSweep.called.bestUsd).toLocaleString('en-US')} ` +
      `statsMeasured=${holderSweep.called.measured}) ` +
      `in ${holderSweep.called.ms}ms, ` +
      `persistedHolders=${holderSweep.persisted.admitted} of ${holderSweep.persisted.candidates} ` +
      `from ${holderSweep.persisted.contracts} established contract(s) ` +
      `(underFloor=${holderSweep.persisted.underFloor} noMark=${holderSweep.persisted.missing} ` +
      `bestMark=$${Math.round(holderSweep.persisted.bestUsd).toLocaleString('en-US')} ` +
      `statsMeasured=${holderSweep.persisted.measured}) ` +
      `in ${holderSweep.persisted.ms}ms, ` +
      `holdersSizedOnPctFallback=${legAudit.marksPicked}`,
    'wallet-discovery',
  )
  // The join is logged on its own line because a leg that reports zero
  // wallets must still say whether the call feed was READ: `feedAvailable`
  // false means the tag is missing from every row for an infrastructure
  // reason, not because no group called anything.
  logger.info(
    `wallet discovery call-groups: available=${callGroups.feedAvailable} ` +
      `queried=${callGroups.tokensQueried} matched=${callGroups.tokensMatched} ` +
      `aboveBar=${callGroups.tokensAboveBar} effective=${callGroups.effectiveGroups} ` +
      `groups=${callGroups.groupsSeen.slice(0, 6).join('|') || 'none'}`,
    'wallet-discovery',
  )

  const byAddress = new Map<string, DiscoveredWallet>()
  for (const w of [...leaderboard, ...highCap]) {
    const existing = byAddress.get(w.address)
    if (!existing) {
      byAddress.set(w.address, w)
      continue
    }
    existing.tags = [...new Set([...existing.tags, ...w.tags])]
    // QUALIFIED beats WATCHLIST regardless of which leg measured it first:
    // the same wallet can be a weak leaderboard row AND a high-cap holder.
    if (existing.admission === 'WATCHLIST' && w.admission === 'QUALIFIED') {
      existing.admission = 'QUALIFIED'
      existing.verdict = w.verdict
      existing.reason = w.reason
      existing.winRate30d = w.winRate30d ?? existing.winRate30d
      existing.pnl30d = w.pnl30d ?? existing.pnl30d
      existing.buyVolume30d = w.buyVolume30d ?? existing.buyVolume30d
      existing.leg = w.leg
    }
  }

  return {
    discovered: [...byAddress.values()],
    refused,
    filterReasons: Object.fromEntries(
      [...filterBuckets].map(([k, b]) => [
        k,
        `${b.n}x (worst ${(b.min * 100).toFixed(0)}%, best ${(b.max * 100).toFixed(0)}%)`,
      ]),
    ),
    refusals,
    leaderboardLeg: leaderboard.length,
    // Each leg reports what IT admitted, not what the merged pool holds: the
    // sweep returns both holder sources in one array, so counting the array
    // made the high-cap leg claim the called holders' admissions as its own.
    highCapLeg: holderSweep.highCapAdmitted,
    calledContractLeg: holderSweep.called.admitted,
    persistedHoldingLeg: holderSweep.persisted.admitted,
    callGroups,
  }
}

/**
 * Merge the stored reason for one admission into the column, capped so the
 * column cannot grow without bound over months of passes.
 *
 * The column is JSON and Prisma returns an ARRAY as a JSON OBJECT
 * (`{0: '...', push: fn()}`) — every field name is the array index, not a
 * key — so the reader normalises to a list first.
 *
 * A discovery pass OVERWRITES winRate/pnl30d/status with its own GMGN
 * measurement, so the classifier reasons that justified those fields
 * (`'PnL 94.2% ≥ 70%, WR 73.9% ≥ 60%, n=23'`) would otherwise be the only
 * surviving trace of a measurement the row no longer shows. They are kept,
 * labelled `prior:`, until the cap evicts the oldest.
 */
const MAX_REASONS = 8

function reasonList(raw: unknown, next: string): string[] {
  const list = Array.isArray(raw)
    ? raw.filter((r): r is string => typeof r === 'string')
    : []
  const merged = list.map((r) => (r.startsWith('prior: ') ? r : `prior: ${r}`))
  return [...merged, next].slice(-MAX_REASONS)
}

/**
 * The status one admission earns in the tracked pool.
 *
 * 'WHALE' is reserved for wallets that cleared the QUALITY axis — winRate >=
 * min AND pnl >= min. A volume-only wallet (the verifier's $250k leg) is
 * whale-scale ACTIVITY, not whale-scale performance: the live pass admitted
 * rows tagged WHALE at pnl -0.78. Storing that as WHALE invited a proven
 * loser into the classification set the strategy gate reads, so a volume-only
 * admission is WATCHLIST — tracked for its buys, never quoted as quality.
 */
export function admissionStatus(w: DiscoveredWallet, f: DiscoveryFilters): string {
  if (w.admission === 'WATCHLIST') return 'WATCHLIST'
  const clearsQuality =
    (w.winRate30d ?? -1) >= f.minWinRate && (w.pnl30d ?? -1) >= f.minPnl
  if (!clearsQuality) return 'WATCHLIST'
  return w.verdict === 'WHALE' ? 'WHALE' : 'QUALIFIED_SMART_MONEY'
}

/** Persist through the Wallet → SmartMoneyWallet one-to-one. Idempotent. */
export async function persistWallets(
  discovered: DiscoveredWallet[],
  f: DiscoveryFilters = DISCOVERY_DEFAULTS,
): Promise<number> {
  let written = 0
  for (const w of discovered) {
    try {
      const wallet = await prisma.wallet.upsert({
        where: { address: w.address },
        create: {
          address: w.address,
          chain: w.chain,
          labels: [w.source],
          lastSeen: new Date(),
        },
        update: {
          lastSeen: new Date(),
        },
      })
      // `labels: { push }` appends unconditionally, so re-running a pass
      // doubled the label on 254 wallets ("gmgn-holder:x" twice) and every
      // later pass doubled it again. Read-then-write keeps the column a set.
      if (!wallet.labels.includes(w.source)) {
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: { labels: { push: w.source } },
        })
      }
      const status = admissionStatus(w, f)
      // Call-group provenance is appended to the reason so the operator can
      // answer "which group flagged the CA this wallet bought" from the DB
      // alone. Kept out of `labels` because labels are the wallet's own
      // source identity, not a per-token observation.
      const called =
        w.callGroups && w.callGroups.groupCount > 0
          ? `;called:${w.callGroups.effectiveGroupCount.toFixed(2)}/${w.callGroups.groups.slice(0, 3).join(',')}`
          : ''
      const reason = `discovered:${w.leg}:${w.source};${w.admission};${w.human.verdict};${w.reason}${called}`
      // 0..70: a 100% win rate and a 700% pnl both sit at the top of the band,
      // so no single wallet can pin the ranking with one extreme number. The
      // earlier `*100 + pnl*10` overflowed—two QUALIFIED wallets (wr 85%,
      // pnl 174%) were stored at score 0 while WATCHLIST rows scored 15..53.
      const score = Math.round(
        Math.max(0, Math.min(70, (w.winRate30d ?? 0) * 50 + (w.pnl30d ?? 0) * 20)),
      )
      const existing = await prisma.smartMoneyWallet.findUnique({
        where: { walletId: wallet.id },
        select: { reasons: true },
      })
      await prisma.smartMoneyWallet.upsert({
        where: { walletId: wallet.id },
        create: {
          walletId: wallet.id,
          category: w.leg === 'leaderboard' ? 'leaderboard' : 'watchlist',
          score,
          status,
          pnl30d: w.pnl30d,
          winRate: w.winRate30d,
          sampleCount: w.buyCount30d ?? 0,
          reasons: [reason],
          classifiedAt: new Date(),
        },
        update: {
          status,
          score,
          pnl30d: w.pnl30d,
          winRate: w.winRate30d,
          sampleCount: w.buyCount30d ?? 0,
          reasons: reasonList(existing?.reasons, reason),
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
