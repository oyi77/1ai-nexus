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
  audit: { refused: Array<{ address: string; reason: string }>; marksPicked: number },
  callGroups: CallGroupsReport,
): Promise<DiscoveredWallet[]> {
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
  // surviving holders actually own, so a token some call group flagged is
  // identified as such before any GMGN stats call is spent.
  const heldContracts = [...new Set(holdersOfScale.map((c) => c.tokenContract))]
  const confluence = await loadCallConfluence(heldContracts, { trustedGroups: f.trustedCallGroups ?? [] })
  readGroups(callGroups, heldContracts, confluence, f.minCallGroups)
  const statsList = await mapLimit(
    holdersOfScale,
    f.concurrency,
    (c) => fetchGmgnWalletStats(c.address).catch(() => null),
    f.budgetMs,
  )
  const out: DiscoveredWallet[] = []
  for (let i = 0; i < holdersOfScale.length; i++) {
    const c = holdersOfScale[i]
    const stats = statsList[i]
    const human = classifyHuman(
      { fastTxRatio: stats?.fastTxRatio ?? null, buyCount30d: stats?.buyCount30d ?? null, sellCount30d: stats?.sellCount30d ?? null },
      f,
    )
    if (human.verdict !== 'HUMAN') {
      audit.refused.push({ address: c.address, reason: `bot check refused: ${human.reason}` })
      continue
    }
    const size = c.valueUsd !== null ? `$${Math.round(c.valueUsd).toLocaleString('en-US')} of a $1M+ token` : 'size unmeasured'
    const conf = confluence.get(c.tokenContract)
    // The operator's ask: tag WHICH group flagged the CA this wallet holds.
    // An unreadable feed stays silent — "no group called it" and "we could
    // not look" are different facts and never share a label. The count is the
    // origin-weighted one the strategy gate uses, so this tag and a later
    // "needs N groups" bar cannot contradict each other.
    const callerTag =
      conf && conf.available && conf.present
        ? `called by ${conf.groupCount} group(s) / ${conf.effectiveGroupCount.toFixed(2)} effective: ` +
          conf.groups.slice(0, 3).join(', ')
        : null
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
      reason:
        `high-cap holder (${c.tags.length > 0 ? c.tags.join('/') : 'untagged'}): holds ${size}` +
        (callerTag ? `; ${callerTag}` : ''),
      leg: 'high-cap-holders',
      human,
    })
  }
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
  leaderboardLeg: number
  highCapLeg: number
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
  const holderAudit = { refused: [] as Array<{ address: string; reason: string }>, marksPicked: 0 }
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
  const highCap = await sweepHighCapHolders(f, holderAudit, callGroups)
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
      `highCapHolders=${highCap.length} in ${bMs}ms, ` +
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
    highCapLeg: highCap.length,
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
      const reason = `discovered:${w.leg}:${w.source};${w.admission};${w.human.verdict};${w.reason}`
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
