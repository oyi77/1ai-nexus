import type { HarvestedWallet } from '@/lib/modules/meme/whale-harvester'

export interface LeaderboardSurvivor {
  w: HarvestedWallet
  tags: string[]
}

/**
 * Order leaderboard candidates so the measurement budget lands on the wallets
 * that can actually clear the bar.
 *
 * QUALITY first, then 30d buy volume, then address for a stable order.
 * Measured live 2026-10-20: 562 merged wallets, 307 cleared the free
 * prefilter, but only 4 cleared the final gate (wr>=0.6 AND pnl>=0.7).
 * Sorting by volume alone spent the whole budget measuring high-volume whales
 * that the quality gate then dropped - those 4 were at risk of never being
 * measured at all.
 */
export function sortLeaderboardSurvivors(
  survivors: Array<[string, LeaderboardSurvivor]>,
  minWinRate: number,
  minPnl: number,
): Array<[string, LeaderboardSurvivor]> {
  const clearsQuality = (w: HarvestedWallet): number =>
    (w.winRate30d ?? 0) >= minWinRate && (w.pnl30d ?? 0) >= minPnl ? 1 : 0
  return [...survivors].sort(
    (a, b) =>
      clearsQuality(b[1].w) - clearsQuality(a[1].w) ||
      (b[1].w.buyVolume30d ?? 0) - (a[1].w.buyVolume30d ?? 0) ||
      a[0].localeCompare(b[0]),
  )
}
