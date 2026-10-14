// ─────────────────────────────────────────────────────────────
// Whale / smart-money wallet harvester.
//
// Sweeps every available wallet source (GMGN wallet leaderboard tags +
// KOLScan verified-KOL roster), dedupes by address, and hands the caller
// persistable rows for the plain `Wallet` table and the operator's
// Google Sheet.
//
// Invariants:
//   - Pure merge/format helpers (mergeHarvest / toSheetRow /
//     toPersistWallet) never touch network, DB, or sheet — fully unit-testable.
//   - Harvest functions degrade per-tag/per-source: a 403 or empty tag
//     simply contributes zero rows; null stats stay null (never fabricated).
// ─────────────────────────────────────────────────────────────

import { listGmgnWalletRank, type GmgnWalletRankRow } from './gmgn'
import { fetchKolscanFeed } from './kolscan'
import { verifyWhaleForList, type WhaleVerification } from './whale-verifier'
import { logger } from '../../logger'
import { setTimeout as sleep } from 'node:timers/promises'

/** GMGN leaderboard tags swept by the harvester (per-tag failure is fine). */
export const WHALE_HARVEST_TAGS: string[] = [
  'smart_degen',
  'pump_smart_degen',
  'sniper',
  'kol',
  'axiom',
  'whale',
  'launchpad_smart',
  'top_followed',
  'wash_trader',
  'bluechip_owner',
  'app_smart_money',
  'arbitrager',
  'photon',
  'bullx',
]

/** Delay between GMGN tag sweeps so the endpoint is never hammered. */
const TAG_DELAY_MS = 800

/** One harvested wallet, source-agnostic. Null stats mean "unmeasured". */
export interface HarvestedWallet {
  address: string
  name: string
  /** First GMGN tag that found the wallet, or `'kolscan'`. */
  source: string
  winRate30d: number | null
  pnl30d: number | null
  realizedProfit30d: number | null
  buyVolume30d: number | null
  /** GMGN verification verdict (WHALE/QUALITY). Absent for KOLScan rows. */
  verification?: 'WHALE' | 'QUALITY'
  /** Windows in which the wallet appeared on a GMGN leaderboard. */
  windows?: string[]
}

export type GmgnRankWindow = '1d' | '7d' | '30d'

/**
 * Shared GMGN sweep + merge for one or more windows. `source` stays the
 * FIRST tag/window that found the wallet, while the stat fields come from
 * the best-ranked row (highest realizedProfit30d ?? pnl30d ?? 0, then best
 * winRate30d). `windows` records every window in which the address
 * appeared. Per-tag/per-window failure (0 rows / 403) is tolerated.
 */
async function sweepGmgnRankings(
  windows: readonly GmgnRankWindow[],
  tags: readonly string[],
  delayMs: number,
): Promise<Map<string, HarvestedWallet>> {
  const byAddress = new Map<string, HarvestedWallet>()
  let calls = 0
  for (const window of windows) {
    for (const tag of tags) {
      if (calls > 0) await sleep(delayMs)
      calls += 1
      let rows: GmgnWalletRankRow[] = []
      try {
        rows = await listGmgnWalletRank(tag, window)
      } catch {
        rows = [] // listGmgnWalletRank already degrades; double-guard here.
      }
      logger.info(
        `GMGN wallet rank window=${window} tag=${tag} rows=${rows.length}`,
        'whale-harvester',
      )
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
        const existing = byAddress.get(row.address)
        byAddress.set(row.address, existing ? mergeRowGmgn(existing, candidate) : candidate)
      }
    }
  }
  return byAddress
}

/**
 * Pure per-address merge used by `sweepGmgnRankings`. Exported so tests
 * can verify the multi-window merge semantics without hitting the network.
 *
 * `existing` is the row already in the map (first-seen). `candidate` is
 * the new row from a later tag/window. The winner keeps `existing.source`
 * (first-seen ownership) but takes the better measured stats, and the
 * `windows` list accumulates every window the address was seen in.
 */
export function mergeRowGmgn(existing: HarvestedWallet, candidate: HarvestedWallet): HarvestedWallet {
  const mergedWindows = existing.windows ?? []
  for (const w of candidate.windows ?? []) {
    if (!mergedWindows.includes(w)) mergedWindows.push(w)
  }
  // Best row wins the stats: realizedProfit30d ?? pnl30d ?? 0, then win rate,
  // then a tie-break preferring non-null buyVolume30d.
  const cScore = candidate.realizedProfit30d ?? candidate.pnl30d ?? 0
  const eScore = existing.realizedProfit30d ?? existing.pnl30d ?? 0
  const better =
    cScore > eScore ||
    (cScore === eScore && (candidate.winRate30d ?? -1) > (existing.winRate30d ?? -1)) ||
    (cScore === eScore &&
      (candidate.winRate30d ?? -1) === (existing.winRate30d ?? -1) &&
      candidate.buyVolume30d !== null &&
      existing.buyVolume30d === null)
  if (better) {
    return { ...candidate, source: existing.source, windows: mergedWindows }
  }
  return { ...existing, windows: mergedWindows }
}

/**
 * Sweep every tag in `tags` against GMGN's wallet leaderboard and merge
 * per-address, keeping the best measured row. `window` defaults to '30d'
 * for backward compatibility; pass an array to sweep several windows.
 * Per-tag failure (0 rows / 403) is tolerated.
 *
 * GMGN verification gate: only wallets that pass `verifyWhaleForList`
 * are returned, and each carries its `verification` label (WHALE/QUALITY).
 * `wr=0 pnl=0` and below-bars rows never enter the whale list.
 */
export async function harvestGmgnWallets(
  window: GmgnRankWindow | readonly GmgnRankWindow[] = '30d',
  tags: readonly string[] = WHALE_HARVEST_TAGS,
): Promise<HarvestedWallet[]> {
  const windows = typeof window === 'string' ? [window] : [...window]
  const byAddress = await sweepGmgnRankings(windows, tags, TAG_DELAY_MS)
  return filterVerifiedWhales([...byAddress.values()])
}

/**
 * Sweep each GMGN window × each tag, merging per-address across windows
 * with the same best-row + gate semantics as `harvestGmgnWallets`.
 * `windows` defaults to ['1d','7d','30d'] — 1d/7d leaderboards surface
 * fresh winners that never appear on the 30d board.
 */
export async function harvestGmgnWalletsMultiWindow(
  windows: readonly GmgnRankWindow[] = ['1d', '7d', '30d'],
  tags: readonly string[] = WHALE_HARVEST_TAGS,
): Promise<HarvestedWallet[]> {
  const byAddress = await sweepGmgnRankings(windows, tags, TAG_DELAY_MS)
  return filterVerifiedWhales([...byAddress.values()])
}

/**
 * Pure post-filter: keep only GMGN rows that pass `verifyWhaleForList`,
 * stamping each with its WHALE/QUALITY label. Exported so tests can cover
 * the gate without hitting the network.
 */
export function filterVerifiedWhales(wallets: HarvestedWallet[]): HarvestedWallet[] {
  const verified: HarvestedWallet[] = []
  for (const w of wallets) {
    const verdict: WhaleVerification = verifyWhaleForList({
      winRate30d: w.winRate30d,
      pnl30d: w.pnl30d,
      buyVolume30d: w.buyVolume30d,
    })
    if (verdict.include && verdict.label !== 'UNVERIFIED') {
      verified.push({ ...w, verification: verdict.label })
    }
  }
  return verified
}

/**
 * Fetch the KOLScan verified-KOL roster and map it to harvested rows.
 * Stats stay null — KOLScan reports identity, not measured PnL.
 */
export async function harvestKolscanWallets(): Promise<HarvestedWallet[]> {
  const feed = await fetchKolscanFeed()
  return feed.wallets.map((w) => ({
    address: w.address,
    name: w.name,
    source: 'kolscan',
    winRate30d: null,
    pnl30d: null,
    realizedProfit30d: null,
    buyVolume30d: null,
  }))
}

export interface KolscanHarvestResult {
  wallets: HarvestedWallet[]
  kolscanTotal: number
  kolscanGmgnVerified: number
  kolscanSourceOnly: number
}

/**
 * Fetch the KOLScan roster and cross-reference each KOL against the
 * GMGN leaderboard rows already harvested by `harvestGmgnWalletsMultiWindow`.
 * KOLs that also appear in GMGN keep their GMGN verification label and
 * stats; the rest are labeled `'KOL'` (source-verified identity only,
 * no measured stats — never fabricated) and must NOT be written to
 * SmartMoneyWallet by callers.
 */
export async function harvestKolscanWalletsVerified(
  gmgnWallets: readonly HarvestedWallet[],
): Promise<KolscanHarvestResult> {
  const feed = await fetchKolscanFeed()
  const gmgnByAddress = new Map(gmgnWallets.map((w) => [w.address, w]))
  const wallets: HarvestedWallet[] = []
  let gmgnVerified = 0
  let sourceOnly = 0

  for (const kol of feed.wallets) {
    const gmgn = gmgnByAddress.get(kol.address)
    if (gmgn) {
      gmgnVerified += 1
      wallets.push({
        ...gmgn,
        name: gmgn.name || kol.name,
      })
    } else {
      sourceOnly += 1
      wallets.push({
        address: kol.address,
        name: kol.name,
        source: 'kolscan',
        winRate30d: null,
        pnl30d: null,
        realizedProfit30d: null,
        buyVolume30d: null,
      })
    }
  }

  return {
    wallets,
    kolscanTotal: feed.wallets.length,
    kolscanGmgnVerified: gmgnVerified,
    kolscanSourceOnly: sourceOnly,
  }
}


/**
 * Pure cross-batch dedupe. On collision prefer the row with the most
 * non-null measured stats (winRate30d / pnl30d / realizedProfit30d), then
 * the lexicographically smallest source. Deterministic regardless of
 * batch order.
 */
export function mergeHarvest(...batches: HarvestedWallet[][]): HarvestedWallet[] {
  const byAddress = new Map<string, HarvestedWallet>()
  for (const batch of batches) {
    for (const w of batch) {
      const existing = byAddress.get(w.address)
      if (!existing) {
        byAddress.set(w.address, w)
        continue
      }
      const existingCount = [existing.winRate30d, existing.pnl30d, existing.realizedProfit30d]
        .filter((v) => v !== null).length
      const incomingCount = [w.winRate30d, w.pnl30d, w.realizedProfit30d]
        .filter((v) => v !== null).length
      if (incomingCount > existingCount || (incomingCount === existingCount && w.source < existing.source)) {
        byAddress.set(w.address, w)
      }
    }
  }
  return [...byAddress.values()]
}

/**
 * Format a harvested wallet as a sheet row (Address, Name).
 *   - GMGN WHALE rows:    `GMGN-WHALE wr=64% pnl=+30%`
 *   - GMGN QUALITY rows:  `GMGN-QUALITY wr=64% pnl=+30%`
 *   - unverified GMGN:    `GMGN-UNVERIFIED wr=.. pnl=..` (null-safe)
 *   - KOLScan rows:       `KOLSCAN {name}` (short-address fallback)
 * Name is capped below 80 chars.
 */
export function toSheetRow(w: HarvestedWallet): { address: string; name: string } {
  let name: string
  if (w.source.toLowerCase() === 'kolscan') {
    name = `KOLSCAN ${w.name.trim() || w.address.slice(0, 8)}`
  } else {
    const wr = w.winRate30d !== null ? `${Math.round(w.winRate30d * 100)}%` : 'n/a'
    const pct = w.pnl30d !== null ? Math.round(w.pnl30d * 100) : null
    const pnl = pct !== null ? `${pct >= 0 ? '+' : ''}${pct}%` : 'n/a'
    const kind = w.verification === 'WHALE' ? 'WHALE' : w.verification === 'QUALITY' ? 'QUALITY' : 'UNVERIFIED'
    name = `GMGN-${kind} wr=${wr} pnl=${pnl}`
  }
  return { address: w.address, name: name.length < 80 ? name : name.slice(0, 79) }
}

/** Persistable `Wallet` row derived from a harvested wallet. */
export interface WhalePersistWallet {
  address: string
  chain: 'solana'
  alias: string | null
  labels: string[]
}

/**
 * Build the persistable Wallet row. Labels are
 * `[sourcePrefix, verification, 'whale-verification']` for GMGN rows
 * (verification ∈ {whale, quality, unverified}), or
 * `[sourcePrefix, 'whale-harvest']` for KOLScan rows; alias reuses the
 * sheet name.
 */
export function toPersistWallet(w: HarvestedWallet): WhalePersistWallet {
  const source = w.source.toLowerCase() === 'kolscan' ? 'kolscan' : 'gmgn'
  if (source === 'gmgn') {
    const verification = w.verification === 'WHALE' ? 'whale' : w.verification === 'QUALITY' ? 'quality' : 'unverified'
    return {
      address: w.address,
      chain: 'solana',
      alias: toSheetRow(w).name || null,
      labels: [source, verification, 'whale-verification'],
    }
  }
  return {
    address: w.address,
    chain: 'solana',
    alias: toSheetRow(w).name || null,
    labels: [source, 'whale-harvest'],
  }
}
