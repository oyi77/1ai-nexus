// ─────────────────────────────────────────────────────────────
// Module: Hyperliquid Copy-Trading Leaderboard
// sourceType: public-api
// upstreamProduct: Hyperliquid leaderboard (stats-data statict dump)
// endpoint: https://stats-data.hyperliquid.xyz/Mainnet/leaderboard
// discoveredVia: community-package
// lastVerified: 2026-08-11
// The stats-data endpoint is a ~34 MB static CDN artifact refreshed
// roughly hourly. We fetch it at module layer, slice to page_size
// immediately, and cache ONLY the normalized slice (never the dump).
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'
import type { CopyTradingLeader, CopyTradingPlatform } from '../copy-trading/types'

const HYPERLIQUID_TTL = TTL.MACRO_DATA // 1 hour — mirrors upstream refresh cadence
const STATS_DATA_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'

interface HlWindowPerf {
  pnl?: string
  roi?: string
  vlm?: string
}

interface HlLeaderRow {
  ethAddress: string
  accountValue?: string
  windowPerformances?: Array<[string, HlWindowPerf]>
  prize?: number
  displayName?: string | null
}

interface HlLeaderboardEnvelope {
  leaderboardRows?: HlLeaderRow[]
}

function toNum(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function windowPerf(rows: Array<[string, HlWindowPerf]>, cycle: string): HlWindowPerf {
  const key = cycle === 'day' || cycle === 'week' ? cycle : 'month'
  const found = rows.find(([k]) => k === key)
  return found?.[1] ?? {}
}

function normalizeHlRows(rows: HlLeaderRow[], cycle: string): CopyTradingLeader[] {
  return rows.map(r => {
    const perf = windowPerf(r.windowPerformances ?? [], cycle)
    return {
      id: r.ethAddress,
      platform: 'hyperliquid' as CopyTradingPlatform,
      nick: r.displayName ?? shortenAddress(r.ethAddress),
      avatar: null,
      level: 0,
      labels: [],
      profit: toNum(perf.pnl),
      profitRate: toNum(perf.roi),
      winRate: 0, // not provided by stats-data
      maxDrawdown: 0, // not provided by stats-data
      sharpe: 0, // not provided by stats-data
      aum: toNum(r.accountValue),
      followers: 0, // not provided by stats-data
      maxFollowers: 0,
      leadingDays: 0,
      plRatio: 0,
      isPrivate: false,
      createTime: null,
    }
  })
}

async function fetchHyperliquidList(pageSize: number, cycle: string): Promise<{ leaders: CopyTradingLeader[]; total: number }> {
  const res = await fetch(STATS_DATA_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Hyperliquid stats-data: HTTP ${res.status}`)
  const body = (await res.json()) as HlLeaderboardEnvelope
  const rows = body.leaderboardRows ?? []
  const sliced = rows.slice(0, pageSize)
  return { leaders: normalizeHlRows(sliced, cycle), total: rows.length }
}

/** Cheap reachability probe: read one body chunk then abort — avoids pulling the whole 34 MB dump. */
async function probeHyperliquid(): Promise<boolean> {
  try {
    const res = await fetch(STATS_DATA_URL, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok || !res.body) return false
    const reader = res.body.getReader()
    const first = await reader.read()
    await reader.cancel().catch(() => undefined)
    return !first.done
  } catch {
    return false
  }
}

const hyperliquidCopyLeaderboardModule: DataModule = {
  id: 'hyperliquid-copy-leaderboard',
  name: 'Hyperliquid Copy-Trading Leaderboard',
  category: 'market',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Hyperliquid leaderboard top accounts via stats-data public dump',
    discoveredVia: 'community-package',
    fragility: 'stable',
    lastVerified: '2026-08-11',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    const ok = await probeHyperliquid()
    const now = new Date()
    return ok
      ? { status: 'active', lastChecked: now, lastSuccess: now, failureCount: 0 }
      : { status: 'offline', lastChecked: now, failureCount: 1, notes: 'stats-data leaderboard unreachable' }
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: { leaders: [], total: 0 } as unknown as T,
      source: 'hyperliquid-copy-leaderboard (empty degraded)',
      cached: true,
      timestamp: Date.now(),
      ttl: HYPERLIQUID_TTL,
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const pageSize = Number(params.page_size ?? 50)
    const cycle = String(params.cycle ?? 'month')
    return cachedFetch<T>(
      'hyperliquid-copy-leaderboard',
      { ...params, platform: params.platform ?? 'hyperliquid', page_size: pageSize },
      HYPERLIQUID_TTL,
      () => fetchHyperliquidList(pageSize, cycle) as Promise<T>,
    )
  },
}

export default hyperliquidCopyLeaderboardModule