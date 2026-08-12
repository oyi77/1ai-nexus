// ─────────────────────────────────────────────────────────────
// GET /api/v1/copy-trading/leaderboard
// Copy-trading leaderboard across platforms (gateio + hyperliquid).
// Per-platform error isolation: one platform failing never 502s
// the whole request — meta.platforms carries each platform's status.
//
// The platform set, per-platform leaderboard modules, and per-platform
// TTLs all live in the copy-trading registry — register a new exchange
// there instead of editing this route.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import {
  COPY_TRADING_REGISTRY,
  getEnabledPlatforms,
  getLeaderboardModule,
} from '@/lib/modules/market/copy-trading/registry'
import type { CopyTradingLeader, CopyTradingPlatform } from '@/lib/modules/market/copy-trading/types'

type PlatformStatus = { platform: CopyTradingPlatform; status: 'ok' | 'error'; error?: string; total?: number }

interface PlatformResult {
  leaders: CopyTradingLeader[]
  status: PlatformStatus
}

async function fetchPlatform(
  platform: CopyTradingPlatform,
  cycle: string,
  orderBy: string,
  pageSize: number,
): Promise<PlatformResult> {
  const mod = getLeaderboardModule(platform)
  try {
    if (!mod) throw new Error(`No leaderboard module registered for platform: ${platform}`)
    const res = await mod.fetch<{ leaders: CopyTradingLeader[]; total: number }>({
      platform,
      cycle,
      order_by: orderBy,
      page_size: pageSize,
    })
    return {
      leaders: res.data.leaders,
      status: { platform, status: 'ok', total: res.data.total },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { leaders: [], status: { platform, status: 'error', error: message } }
  }
}

function sortLeaders(leaders: CopyTradingLeader[], orderBy: string): CopyTradingLeader[] {
  const key = orderBy === 'profit' ? 'profit' : orderBy === 'win_rate' ? 'winRate' : 'aum'
  return [...leaders].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const platformParam = (searchParams.get('platform') ?? 'all').toLowerCase()
  const cycle = searchParams.get('cycle') ?? 'month'
  const orderBy = searchParams.get('order_by') ?? 'aum'
  const pageSize = Math.min(Math.max(Number(searchParams.get('page_size') ?? 50) || 50, 1), 200)

  const enabledPlatforms = getEnabledPlatforms()
  const platform = (enabledPlatforms as readonly string[]).includes(platformParam)
    ? (platformParam as CopyTradingPlatform)
    : 'all'

  try {
    if (platform !== 'all') {
      const ttl = COPY_TRADING_REGISTRY[platform].ttlMs
      const { data, fromCache } = await getCached(
        `copy-trading:leaderboard:${platform}:${cycle}:${orderBy}:${pageSize}`,
        ttl,
        () => fetchPlatform(platform, cycle, orderBy, pageSize),
      )
      const leaders = sortLeaders(data.leaders, orderBy)
      const resp = NextResponse.json({
        data: {
          leaders,
          meta: { platforms: [data.status], total: data.status.total ?? leaders.length, updatedAt: new Date().toISOString() },
        },
        error: null,
      })
      resp.headers.set('Cache-Control', `public, max-age=${Math.floor(ttl / 1000)}`)
      resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
      return resp
    }

    // 'all' — fetch each enabled platform independently so one failure never 502s the request
    const results = await Promise.all(enabledPlatforms.map((p) => fetchPlatform(p, cycle, orderBy, pageSize)))
    const leaders = sortLeaders(results.flatMap((r) => r.leaders), orderBy)
    const platforms: PlatformStatus[] = results.map((r) => r.status)
    const total = platforms.reduce((sum, p) => sum + (p.total ?? 0), 0)

    const resp = NextResponse.json({
      data: { leaders, meta: { platforms, total, updatedAt: new Date().toISOString() } },
      error: null,
    })
    resp.headers.set('Cache-Control', 'public, max-age=180')
    return resp
  } catch (error) {
    // All platforms failed (module caches + fallbacks exhausted) — still a 200 with explicit statuses
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({
      data: { leaders: [], meta: { platforms: [], total: 0, updatedAt: new Date().toISOString() } },
      error: message,
    })
  }
}
