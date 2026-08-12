// ─────────────────────────────────────────────────────────────
// Copy-Trading Leaderboard — shared types
// Normalized Leader row shape common to gate.io (re) and
// Hyperliquid (public-api) copy-trading leaderboards.
// ─────────────────────────────────────────────────────────────

export type CopyTradingPlatform = 'gateio' | 'hyperliquid' | 'binance' | 'bybit' | 'okx' | 'bitget'

export const COPY_TRADING_PLATFORMS: CopyTradingPlatform[] = [
  'gateio',
  'hyperliquid',
  // ── Pending research ────────────────────────────────────
  // Registered so APIs/pages can enumerate them, but disabled in
  // the copy-trading registry until their modules land.
  'binance',
  'bybit',
  'okx',
  'bitget',
]

/** Normalized leader row — shared across platforms. */
export interface CopyTradingLeader {
  id: string
  platform: CopyTradingPlatform
  nick: string
  avatar: string | null
  level: number
  labels: string[]
  profit: number
  profitRate: number
  winRate: number
  maxDrawdown: number
  sharpe: number
  aum: number
  followers: number
  maxFollowers: number
  leadingDays: number
  plRatio: number
  isPrivate: boolean
  createTime: number | null
}

export interface LeaderboardResponse {
  leaders: CopyTradingLeader[]
  meta: {
    platforms: CopyTradingPlatform[]
    total: number
    updatedAt: string
  }
}