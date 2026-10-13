// ─────────────────────────────────────────────────────────────
// Axiom wallet monitor — GMGN tag-based.
//
// axiom.trade itself is behind Cloudflare + auth (HTTP 425 on api2/
// translate/rh-api without session cookie). Its REST/WS endpoints
// (discover1/2, pulse-unified1/2, friends) all return 404/425 keyless.
//
// Instead, this module uses GMGN's `axiom` leaderboard tag to identify
// wallets tracked by Axiom. GMGN tags wallets that Axiom has verified as
// human KOL traders — exactly the "hindari transaksi bot" requirement.
//
// Pipeline:
//   1. listGmgnWalletRank('axiom', '30d') → 100 rows, ~27 carry winRate30d
//   2. fetchGmgnWalletStats(addr) per wallet → pnl30d, buyCount30d, fastTxRatio
//   3. Filter: winRate30d >= 60% AND fastTxRatio < 50% (human, not sniper-bot)
//   4. The wallet list feeds the existing wallet-refresh-cron harvest —
//      those wallets' on-chain buys become discovery candidates via the
//      standard foldWalletBuys path.
// ─────────────────────────────────────────────────────────────
import { listGmgnWalletRank, fetchGmgnWalletStats, type GmgnWalletStats } from './gmgn/index'
export interface AxiomWallet {
  address: string
  name: string | null
  tags: string[]
  winRate30d: number | null
  pnl30d: number | null
  realizedProfit30d: number | null
  buyCount30d: number | null
  sellCount30d: number | null
  fastTxRatio: number | null
  /** True when the wallet passed the human-vs-bot heuristic. */
  isHuman: boolean
  /** Human-readable reason for the human/bot verdict. */
  humanReason: string
}

export const AXIOM_THRESHOLDS = {
  /** Minimum GMGN 30d win rate as a fraction (user-specified 60%). */
  minWinRate: 0.6,
  /**
   * Maximum fast-tx ratio (fraction of buys that were sniper-fast).
   * Above this threshold the wallet looks like a bot sniper, not a human.
   * 50% mirrors the operator spec: "hindari transaksi bot" — a human
   * KOL might snipe occasionally, but more than half their buys being
   * sub-second is a strong automation signal.
   */
  maxFastTxRatio: 0.5,
  /** Minimum 30d buy count to consider the wallet active (statistical significance). */
  minBuyCount: 10,
} as const

/**
 * Determine whether a wallet is human-like based on its GMGN fast-tx ratio
 * and buy/sell pattern. Pure function — no I/O.
 *
 * Bot signals:
 *   - fastTxRatio >= 50% → most buys are sub-second sniper calls (automation)
 *   - buyCount30d with zero sells → buy-only bot (dump-and-abandon pattern)
 *   - buyCount30d < 10 → too few trades to classify (UNKNOWN, not human)
 */
export function classifyHuman(
  stats: Partial<Pick<GmgnWalletStats, 'fastTxRatio' | 'buyCount30d' | 'sellCount30d'>>,
): { isHuman: boolean; reason: string } {
  const fastTx = stats.fastTxRatio ?? null
  const buys = stats.buyCount30d ?? null
  const sells = stats.sellCount30d ?? null

  if (buys === null || (buys ?? 0) < AXIOM_THRESHOLDS.minBuyCount) {
    return { isHuman: false, reason: `too few buys (${buys ?? 0} < ${AXIOM_THRESHOLDS.minBuyCount})` }
  }
  if (fastTx !== null && fastTx >= AXIOM_THRESHOLDS.maxFastTxRatio) {
    return { isHuman: false, reason: `fast-tx ${(fastTx * 100).toFixed(0)}% >= ${(AXIOM_THRESHOLDS.maxFastTxRatio * 100).toFixed(0)}% (sniper-bot pattern)` }
  }
  if (sells !== null && sells === 0 && (buys ?? 0) > 50) {
    return { isHuman: false, reason: 'buy-only with 0 sells over 50+ buys (dump-and-abandon bot)' }
  }
  const fastTxtStr = fastTx !== null ? `${(fastTx * 100).toFixed(0)}%` : 'unknown'
  return { isHuman: true, reason: `fast-tx ${fastTxtStr} < ${(AXIOM_THRESHOLDS.maxFastTxRatio * 100).toFixed(0)}%, buys=${buys}, sells=${sells ?? '?'}` }
}

/**
 * Fetch Axiom-tracked wallets from GMGN's `axiom` tag leaderboard and
 * enrich each with per-wallet stats (pnl30d, fastTxRatio, buy/sell counts).
 *
 * Filters:
 *   - winRate30d >= 60% (user-specified)
 *   - Human classification (fastTxRatio < 50%, not buy-only bot)
 *
 * Returns wallets that PASS both filters, sorted by descending win rate.
 * Never fabricates: a wallet with null winRate is excluded.
 */
export async function fetchAxiomWallets(): Promise<AxiomWallet[]> {
  const rankRows = await listGmgnWalletRank('axiom', '30d')
  if (rankRows.length === 0) return []

  const out: AxiomWallet[] = []
  for (const row of rankRows) {
    // Only enrich wallets that have a win rate — the rest can't pass the gate.
    if (row.winRate30d === null || row.winRate30d < AXIOM_THRESHOLDS.minWinRate) continue

    const stats = await fetchGmgnWalletStats(row.address).catch(() => null)
    const human = classifyHuman(stats ?? {})
    if (!human.isHuman) continue

    out.push({
      address: row.address,
      name: null,
      tags: [...row.tags, ...stats?.tags ?? []],
      winRate30d: row.winRate30d,
      pnl30d: stats?.pnl30d ?? row.pnl30d,
      realizedProfit30d: stats?.realizedProfit30d ?? row.realizedProfit30d,
      buyCount30d: stats?.buyCount30d ?? null,
      sellCount30d: stats?.sellCount30d ?? null,
      fastTxRatio: stats?.fastTxRatio ?? null,
      isHuman: true,
      humanReason: human.reason,
    })
    // GMGN rate limit: ~1 req/sec
    await new Promise((r) => setTimeout(r, 1000))
  }

  return out.sort((a, b) => (b.winRate30d ?? 0) - (a.winRate30d ?? 0))
}
