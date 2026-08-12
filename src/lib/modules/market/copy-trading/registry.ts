// ─────────────────────────────────────────────────────────────
// Copy-Trading Platform Registry
//
// Single source of truth for which copy-trading exchanges are
// wired into the API. Routes dispatch through this registry instead
// of hardcoding platform → module/TTL pairs.
//
// Adding a new exchange:
//   1. Extend `CopyTradingPlatform` + `COPY_TRADING_PLATFORMS` in
//      ./types (done for binance/bybit/okx/bitget — binance module
//      landed and is enabled; bybit/okx/bitget pending research).
//   2. Wire the platform's leaderboard module (and performance
//      module, where the per-leader endpoint is reverse-engineered)
//      into `COPY_TRADING_REGISTRY` below.
//   3. Flip `enabled: true` once the module is production-ready.
//
// No route edits are needed — both API routes enumerate this
// registry and per-platform error isolation lives in the routes.
// ─────────────────────────────────────────────────────────────

import type { DataModule } from '@/lib/modules/types'
import gateioCopyLeaderboardModule from '@/lib/modules/market/gateio-copy/leaderboard'
import hyperliquidCopyLeaderboardModule from '@/lib/modules/market/hyperliquid-copy/leaderboard'
import binanceCopyLeaderboardModule from '@/lib/modules/market/binance-copy/leaderboard'
import bybitCopyLeaderboardModule from '@/lib/modules/market/bybit-copy/leaderboard'
import okxCopyLeaderboardModule from '@/lib/modules/market/okx-copy/leaderboard'
import bitgetCopyLeaderboardModule from '@/lib/modules/market/bitget-copy/leaderboard'
import gateioPerformanceModule from '@/lib/modules/derivatives/gateio/performance'
import binancePerformanceModule from '@/lib/modules/derivatives/binance/performance'
import { COPY_TRADING_PLATFORMS, type CopyTradingPlatform } from './types'

export interface CopyTradingPlatformEntry {
  platform: CopyTradingPlatform
  /** Leaderboard module consumed by GET /api/v1/copy-trading/leaderboard. */
  leaderboardModule?: DataModule
  /** Optional per-leader performance module consumed by GET /api/v1/copy-trading/performance. */
  performanceModule?: DataModule
  /** Route-layer cache TTL (ms). Mirrors the platform's leaderboard module TTL. */
  ttlMs: number
  /** `true` only once `leaderboardModule` is wired and production-ready. */
  enabled: boolean
}

const registry: Record<CopyTradingPlatform, CopyTradingPlatformEntry> = {
  gateio: {
    platform: 'gateio',
    leaderboardModule: gateioCopyLeaderboardModule,
    performanceModule: gateioPerformanceModule,
    ttlMs: 180_000, // mirrors gateio-copy-leaderboard module TTL (TOKEN_DATA × RE_MULTIPLIER)
    enabled: true,
  },
  hyperliquid: {
    platform: 'hyperliquid',
    leaderboardModule: hyperliquidCopyLeaderboardModule,
    ttlMs: 3_600_000, // mirrors hyperliquid-copy-leaderboard module TTL (MACRO_DATA)
    enabled: true,
  },
  binance: {
    platform: 'binance',
    leaderboardModule: binanceCopyLeaderboardModule,
    performanceModule: binancePerformanceModule,
    ttlMs: 180_000, // mirrors binance-copy-leaderboard module TTL (TOKEN_DATA × RE_MULTIPLIER)
    enabled: true,
  },
  // ── Pending research ─────────────────────────────────────
  // Exchanges whose copy-trading endpoints are still being probed.
  // Wire modules + flip `enabled: true` once they land; disabled
  // entries are never fetched by either route. (Binance, Bitget and
  // OKX landed — see entries above.) Bybit is geo-blocked from this
  // host (module present, probe fails), so it stays disabled until
  // a working route is found.
  bybit: {
    platform: 'bybit',
    leaderboardModule: bybitCopyLeaderboardModule,
    ttlMs: 0, // mirrors bybit-copy-leaderboard TTL (0 = disabled while geo-blocked)
    enabled: false,
  },
  okx: {
    platform: 'okx',
    leaderboardModule: okxCopyLeaderboardModule,
    ttlMs: 180_000, // mirrors okx-copy-leaderboard module TTL (TOKEN_DATA × RE_MULTIPLIER)
    enabled: true,
  },
  bitget: {
    platform: 'bitget',
    leaderboardModule: bitgetCopyLeaderboardModule,
    ttlMs: 180_000, // mirrors bitget-copy-leaderboard module TTL (TOKEN_DATA × RE_MULTIPLIER)
    enabled: true,
  },
}

/** Platform → entry map. Single source of truth for module + TTL wiring. */
export const COPY_TRADING_REGISTRY: Record<CopyTradingPlatform, CopyTradingPlatformEntry> = registry

/** Leaderboard module for a platform, or `undefined` when unregistered/disabled. */
export function getLeaderboardModule(platform: CopyTradingPlatform): DataModule | undefined {
  const entry = registry[platform]
  return entry?.enabled ? entry.leaderboardModule : undefined
}

/** Performance module for a platform, or `undefined` when none is registered. */
export function getPerformanceModule(platform: CopyTradingPlatform): DataModule | undefined {
  return registry[platform]?.performanceModule
}

/** True when the platform is enabled AND has a leaderboard module (misconfiguration guard). */
export function isPlatformEnabled(platform: CopyTradingPlatform): boolean {
  return getLeaderboardModule(platform) !== undefined
}

/** Enabled platforms in `COPY_TRADING_PLATFORMS` declared order (stable output order). */
export function getEnabledPlatforms(): CopyTradingPlatform[] {
  return COPY_TRADING_PLATFORMS.filter((p) => isPlatformEnabled(p))
}

export { COPY_TRADING_PLATFORMS, type CopyTradingPlatform } from './types'
