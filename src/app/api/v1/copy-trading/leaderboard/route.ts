// ─────────────────────────────────────────────────────────────
// GET /api/v1/copy-trading/leaderboard
// Copy-trading leaderboard across platforms (gateio + hyperliquid).
// Per-platform error isolation: one platform failing never 502s
// the whole request — meta.platforms carries each platform's status.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import gateioCopyLeaderboardModule from '@/lib/modules/market/gateio-copy/leaderboard'
import hyperliquidCopyLeaderboardModule from '@/lib/modules/market/hyperliquid-copy/leaderboard'
import type { CopyTradingLeader, CopyTradingPlatform } from '@/lib/modules/market/copy-trading/types'

const PLATFORM_TTL: Record<CopyTradingPlatform, number> = {
  gateio: 180_000, // mirrors gateio-copy-leaderboard module TTL (TOKEN_DATA × RE_MULTIPLIER)
  hyperliquid: 3_600_000, // mirrors hyperliquid-copy-leaderboard module TTL (MACRO_DATA)
}

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
  const mod = platform === 'gateio' ? gateioCopyLeaderboardModule : hyperliquidCopyLeaderboardModule
  try {
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

  const platform = platformParam === 'gateio' || platformParam === 'hyperliquid' ? platformParam : 'all'

  try {
    if (platform !== 'all') {
      const { data, fromCache } = await getCached(
        `copy-trading:leaderboard:${platform}:${cycle}:${orderBy}:${pageSize}`,
        PLATFORM_TTL[platform],
        () => fetchPlatform(platform as CopyTradingPlatform, cycle, orderBy, pageSize),
      )
      const leaders = sortLeaders(data.leaders, orderBy)
      const resp = NextResponse.json({
        data: {
          leaders,
          meta: { platforms: [data.status], total: data.status.total ?? leaders.length, updatedAt: new Date().toISOString() },
        },
        error: null,
      })
      resp.headers.set('Cache-Control', `public, max-age=${Math.floor(PLATFORM_TTL[platform as CopyTradingPlatform] / 1000)}`)
      resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
      return resp
    }

    // 'all' — fetch each platform independently so one failure never 502s the request
    const [gateio, hyperliquid] = await Promise.all([
      fetchPlatform('gateio', cycle, orderBy, pageSize),
      fetchPlatform('hyperliquid', cycle, orderBy, pageSize),
    ])
    const leaders = sortLeaders([...gateio.leaders, ...hyperliquid.leaders], orderBy)
    const platforms: PlatformStatus[] = [gateio.status, hyperliquid.status]
    const total = platforms.reduce((sum, p) => sum + (p.total ?? 0), 0)

    const resp = NextResponse.json({
      data: { leaders, meta: { platforms, total, updatedAt: new Date().toISOString() } },
      error: null,
    })
    resp.headers.set('Cache-Control', 'public, max-age=180')
    return resp
  } catch (error) {
    // Both platforms failed (module caches + fallbacks exhausted) — still a 200 with explicit statuses
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({
      data: { leaders: [], meta: { platforms: [], total: 0, updatedAt: new Date().toISOString() } },
      error: message,
    })
  }
}