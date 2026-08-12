// ─────────────────────────────────────────────────────────────
// Module: Bybit Copy-Trading Leaderboard (STUB)
// sourceType: pending
// upstreamProduct: Bybit copy-trading leaderboard web dashboard
// endpoint: unknown — not yet reverse-engineered
// lastVerified: 2026-08-11
// STUB: disabled in the copy-trading registry (enabled: false).
//   Research found wss://ws2.bybit.com/realtime_w (gzip-compressed
//   frames) but it carries MT5/forex copy trading, NOT crypto
//   leaderboard data. The crypto copy-trading leaderboard REST
//   endpoint was not captured. Replace this stub with a real
//   implementation once the endpoint is found, then flip the
//   registry entry to enabled: true.
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import type { CopyTradingLeader, CopyTradingPlatform } from '../copy-trading/types'

/** Disabled — stub has no live data path. Mirrors the registry `ttlMs: 0`. */
const BYBIT_TTL = 0

const BYBIT_PLATFORM: CopyTradingPlatform = 'bybit'

/** Stub probe: reports the known research state (degraded — no endpoint yet). */
async function probeBybit(): Promise<ModuleHealth> {
  return {
    status: 'degraded',
    lastChecked: new Date(),
    failureCount: 0,
    notes: 'crypto copy trading leaderboard endpoint not found; WebSocket realtime_w carries MT5 data only',
  }
}

const bybitCopyLeaderboardModule: DataModule = {
  id: 'bybit-copy-leaderboard',
  name: 'Bybit Copy-Trading Leaderboard',
  category: 'market',
  sourceType: 'pending',
  provenance: {
    describesItself: 'Bybit copy-trading leaderboard — stub pending endpoint reverse-engineering',
    fragility: 'unknown',
    lastVerified: '2026-08-11',
    toleratesAbsence: true,
    notes: 'WebSocket wss://ws2.bybit.com/realtime_w with gzip frames found but contains MT5/forex copy trading, not crypto',
  },

  isEnabled: () => false,

  async healthCheck(): Promise<ModuleHealth> {
    return probeBybit()
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: { leaders: [] as CopyTradingLeader[], total: 0 } as unknown as T,
      source: `bybit-copy-leaderboard (empty degraded — ${BYBIT_PLATFORM} endpoint pending)`,
      cached: false,
      timestamp: Date.now(),
      ttl: BYBIT_TTL,
    }
  },

  async fetch<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    throw new Error(
      'Bybit copy trading leaderboard endpoint not yet reverse-engineered (WebSocket realtime_w carries MT5/forex data, crypto leaderboard endpoint unknown)',
    )
  },
}

export default bybitCopyLeaderboardModule
