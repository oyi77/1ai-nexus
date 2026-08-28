// ─────────────────────────────────────────────────────────────
// GET /api/v1/meme/leaderboard
// Meme / memecoin discovery leaderboard across platforms (bitget + gate).
// Per-platform error isolation: one platform failing never 502s the whole
// request — meta.platformsStatus carries each platform's status.
//
// The platform set, per-platform discovery modules, and per-platform TTLs
// all live in the meme registry — register a new source there instead of
// editing this route.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import {
  MEME_REGISTRY,
  getDiscoveryModule,
  getEnabledPlatforms,
  normalizeMemePlatformParam,
  type MemePlatform,
} from '@/lib/modules/meme'
import type { MemeAlphaToken, MemeDiscoveryResponse } from '@/lib/modules/meme/types'

type PlatformStatus = { ok: boolean; error?: string }

interface PlatformResult {
  tokens: MemeAlphaToken[]
  status: PlatformStatus
}

async function fetchPlatform(platform: MemePlatform, limit: number): Promise<PlatformResult> {
  const mod = getDiscoveryModule(platform)
  try {
    if (!mod) throw new Error(`No discovery module registered for platform: ${platform}`)
    const res = await mod.fetch<{ tokens: MemeAlphaToken[]; total: number }>({ platform, limit })
    return { tokens: res.data.tokens, status: { ok: true } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { tokens: [], status: { ok: false, error: message } }
  }
}

function sortByMetrics(tokens: MemeAlphaToken[]): MemeAlphaToken[] {
  // Rank by a composite of volume + momentum (desc). Mirrors the shared
  // MemeAlphaToken shape: volume24h, change24h, marketCap, liquidity.
  return [...tokens].sort((a, b) => {
    const score = (t: MemeAlphaToken) =>
      (t.volume24h ?? 0) / 1e6 + (t.marketCap ?? 0) / 1e9 + (t.change24h ?? 0)
    return score(b) - score(a)
  })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const platformParam = (searchParams.get('platform') ?? 'all').toLowerCase()
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 50) || 50, 1), 200)

  const platform: MemePlatform | 'all' = normalizeMemePlatformParam(platformParam)

  try {
    if (platform !== 'all') {
      const entry = MEME_REGISTRY[platform]
      const ttl = entry?.ttlMs ?? 180_000
      const { data, fromCache } = await getCached(
        `meme:leaderboard:${platform}:${limit}`,
        ttl,
        () => fetchPlatform(platform, limit),
      )
      const tokens = sortByMetrics(data.tokens)
      const body: MemeDiscoveryResponse = {
        tokens,
        meta: {
          platforms: [platform],
          total: tokens.length,
          updatedAt: new Date().toISOString(),
          platformsStatus: { [platform]: data.status },
        },
      }
      const resp = NextResponse.json(body)
      resp.headers.set('Cache-Control', `public, max-age=${Math.floor(ttl / 1000)}`)
      resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
      return resp
    }

    // 'all' — fetch each enabled platform independently so one failure never 502s the request
    const enabledPlatforms = getEnabledPlatforms()
    const results = await Promise.all(enabledPlatforms.map((p) => fetchPlatform(p, limit)))
    const tokens = sortByMetrics(results.flatMap((r) => r.tokens))
    const platformsStatus: Record<string, PlatformStatus> = {}
    for (const r of results) platformsStatus[r.status.ok ? '' : ''] // placeholder, replaced below
    const statusMap: Record<string, PlatformStatus> = {}
    results.forEach((r, i) => {
      statusMap[enabledPlatforms[i]] = r.status
    })
    const body: MemeDiscoveryResponse = {
      tokens,
      meta: {
        platforms: enabledPlatforms,
        total: tokens.length,
        updatedAt: new Date().toISOString(),
        platformsStatus: statusMap,
      },
    }
    const resp = NextResponse.json(body)
    resp.headers.set('Cache-Control', 'public, max-age=180')
    return resp
  } catch (error) {
    // All platforms failed (module caches + fallbacks exhausted) — still a 200 with explicit statuses
    const message = error instanceof Error ? error.message : String(error)
    const body: MemeDiscoveryResponse = {
      tokens: [],
      meta: {
        platforms: [],
        total: 0,
        updatedAt: new Date().toISOString(),
        platformsStatus: { all: { ok: false, error: message } },
      },
    }
    return NextResponse.json(body)
  }
}
