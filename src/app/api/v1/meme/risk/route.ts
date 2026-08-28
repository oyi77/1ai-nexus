// ─────────────────────────────────────────────────────────────
// GET /api/v1/meme/risk
// Per-platform meme-token honeypot / rug risk audit.
//
//   ?platform=all|bitget|gate|moby&chain=<chainId>&contract=<address>
//
// The audit modules are obtained via `getAuditModule(platform)` from the
// meme registry. For `platform: 'all'` we iterate the enabled platforms and
// keep only those with a registered audit module, fetching each independently.
//
// Per-platform error isolation: one platform failing never 500s the whole
// request — its status is recorded in `meta.platforms` and we continue. The
// single-platform 400 case is reserved for a platform that has no audit
// module at all (mirrors leaderboard's unsupported-platform handling).
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  getAuditModule,
  getEnabledPlatforms,
  normalizeMemePlatformParam,
  type MemePlatform,
} from '@/lib/modules/meme'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'

interface PlatformStatus {
  platform: MemePlatform
  ok: boolean
  error?: string
}

interface PlatformFetchResult {
  audits: MemeRiskAudit[]
  status: { ok: boolean; error?: string }
}

async function fetchAudit(
  platform: MemePlatform,
  chain: string,
  contract: string,
): Promise<PlatformFetchResult> {
  const mod = getAuditModule(platform)
  try {
    if (!mod) throw new Error(`No audit module registered for platform: ${platform}`)
    const res = await mod.fetch<MemeRiskAudit[]>({ chain, contract })
    const audits = Array.isArray(res.data) ? res.data : []
    return { audits, status: { ok: true } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { audits: [], status: { ok: false, error: message } }
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const platformParam = (searchParams.get('platform') ?? 'all').toLowerCase()
  const chain = (searchParams.get('chain') ?? '').trim()
  const contract = (searchParams.get('contract') ?? '').trim()

  const platform: MemePlatform | 'all' = normalizeMemePlatformParam(platformParam)

  // A risk audit is per-contract; contract is required.
  if (!contract) {
    return NextResponse.json(
      { error: 'Missing required query parameter: contract' },
      { status: 400 },
    )
  }

  const timestamp = new Date().toISOString()

  try {
    if (platform !== 'all') {
      // Single platform — explicit 400 when no audit module exists for it.
      if (!getAuditModule(platform)) {
        return NextResponse.json(
          {
            error: `Unsupported platform: ${platform}. No meme risk-audit module is registered for it.`,
          },
          { status: 400 },
        )
      }
      const result = await fetchAudit(platform, chain, contract)
      const data = result.audits
      const body = {
        data,
        meta: {
          platform,
          platforms: [{ platform, ...result.status }] as PlatformStatus[],
          count: data.length,
          timestamp,
        },
      }
      return NextResponse.json(body)
    }

    // 'all' — fetch each enabled platform that has an audit module, independently
    // so one failure never 500s the whole response.
    const enabledPlatforms = getEnabledPlatforms().filter((p) => getAuditModule(p) !== undefined)
    const results = await Promise.all(
      enabledPlatforms.map((p) => fetchAudit(p, chain, contract)),
    )
    const data = results.flatMap((r) => r.audits)
    const platforms: PlatformStatus[] = enabledPlatforms.map((p, i) => ({
      platform: p,
      ...results[i].status,
    }))
    const body = {
      data,
      meta: {
        platform: 'all' as const,
        platforms,
        count: data.length,
        timestamp,
      },
    }
    return NextResponse.json(body)
  } catch (error) {
    // Should not normally fire (per-platform try/catch isolates failures), but
    // never let an unexpected error 500 the response — report empty with status.
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({
      data: [],
      meta: {
        platform: platform === 'all' ? ('all' as const) : platform,
        platforms: [{ platform, ok: false, error: message }] as PlatformStatus[],
        count: 0,
        timestamp,
      },
    })
  }
}
