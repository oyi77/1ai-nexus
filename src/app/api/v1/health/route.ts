// ─────────────────────────────────────────────────────────────
// GET /api/v1/health — Comprehensive health check
// Returns status of all services: web, ws, redis, indexer
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

export async function GET() {
  const checks: Record<string, unknown> = {}

  // 1. Redis health
  try {
    const mod = await import('@/lib/redis')
    const redis = mod.getRedisClient()
    await redis.ping()
    checks.redis = 'ok'
  } catch {
    checks.redis = 'down'
  }

  // 2. Database health
  try {
    const { prisma } = await import('@/lib/db')
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch {
    checks.database = 'down'
  }

  // 3. WS server health
  try {
    const res = await fetch('http://localhost:4401/health', { signal: AbortSignal.timeout(10_000) })
    const data = await res.json() as Record<string, unknown>
    checks.ws = data.status
    checks.wsStreams = data.streams ?? '?'
  } catch {
    checks.ws = 'down'
  }

  // 4. Indexer health
  try {
    const res = await fetch('http://localhost:4409/health', { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>
      checks.indexer = data.status || 'ok'
    } else {
      checks.indexer = 'down'
    }
  } catch {
    // Indexer may not expose /health endpoint — check if port 4409 is reachable
    try {
      const ctrl = new AbortController()
      setTimeout(() => ctrl.abort(), 3000)
      await fetch('http://localhost:4409/', { signal: ctrl.signal })
      checks.indexer = 'ok'
    } catch {
      checks.indexer = 'down'
    }
  }

  // 5. Entity count (sanity check)
  try {
    const { prisma } = await import('@/lib/db')
    const count = await prisma.entity.count()
    checks.entities = count
    checks.dataIntegrity = count > 1000 ? 'ok' : 'degraded'
  } catch {
    checks.dataIntegrity = 'unknown'
  }

  const allOk = Object.values(checks).every(v => v === 'ok' || typeof v === 'number' || v === true)
  const status = allOk ? 'ok' : 'degraded'

  const resp = NextResponse.json({
    status,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
  })

  resp.headers.set('Cache-Control', 'no-cache')
  return resp
}
