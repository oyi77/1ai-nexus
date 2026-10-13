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
import { logger } from '../../logger'
import { setTimeout as sleep } from 'node:timers/promises'

/** GMGN leaderboard tags swept by the harvester (per-tag failure is fine). */
export const WHALE_HARVEST_TAGS = [
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
] as const

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
}

/**
 * Sweep every tag in `tags` against GMGN's wallet leaderboard and merge
 * per-address, keeping the best measured row (highest
 * realizedProfit30d ?? pnl30d ?? 0, then best winRate30d). `source` stays
 * the FIRST tag that found the wallet, while the stat fields come from the
 * best-ranked row. Per-tag failure (0 rows / 403) is tolerated.
 */
export async function harvestGmgnWallets(
  window: '1d' | '7d' | '30d' = '30d',
  tags: readonly string[] = WHALE_HARVEST_TAGS,
): Promise<HarvestedWallet[]> {
  const byAddress = new Map<string, HarvestedWallet>()
  for (let i = 0; i < tags.length; i++) {
    if (i > 0) await sleep(TAG_DELAY_MS)
    const tag = tags[i]
    let rows: GmgnWalletRankRow[] = []
    try {
      rows = await listGmgnWalletRank(tag, window)
    } catch {
      rows = [] // listGmgnWalletRank already degrades; double-guard here.
    }
    logger.info(`GMGN wallet rank tag=${tag} rows=${rows.length}`, 'whale-harvester')
    for (const row of rows) {
      const candidate: HarvestedWallet = {
        address: row.address,
        name: '',
        source: tag,
        winRate30d: row.winRate30d,
        pnl30d: row.pnl30d,
        realizedProfit30d: row.realizedProfit30d,
      }
      const existing = byAddress.get(row.address)
      if (!existing) {
        byAddress.set(row.address, candidate)
        continue
      }
      // Best row wins the stats: realizedProfit30d ?? pnl30d ?? 0, then win rate.
      const cScore = candidate.realizedProfit30d ?? candidate.pnl30d ?? 0
      const eScore = existing.realizedProfit30d ?? existing.pnl30d ?? 0
      const better =
        cScore > eScore ||
        (cScore === eScore && (candidate.winRate30d ?? -1) > (existing.winRate30d ?? -1))
      if (better) {
        // First tag keeps ownership; better row supplies the measurements.
        byAddress.set(row.address, { ...candidate, source: existing.source })
      }
    }
  }
  return [...byAddress.values()]
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
  }))
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
 *   - GMGN rows:   `GMGN wr=64% pnl=+30%` (null-safe `n/a`)
 *   - KOLScan rows: `KOLSCAN {name}` (short-address fallback)
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
    name = `GMGN wr=${wr} pnl=${pnl}`
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
 * Build the persistable Wallet row. Labels are `[sourcePrefix, 'whale-harvest']`
 * with sourcePrefix ∈ {'gmgn', 'kolscan'}; alias reuses the sheet name.
 */
export function toPersistWallet(w: HarvestedWallet): WhalePersistWallet {
  const source = w.source.toLowerCase() === 'kolscan' ? 'kolscan' : 'gmgn'
  return {
    address: w.address,
    chain: 'solana',
    alias: toSheetRow(w).name || null,
    labels: [source, 'whale-harvest'],
  }
}
