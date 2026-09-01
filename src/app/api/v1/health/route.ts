// ─────────────────────────────────────────────────────────────
// GET /api/v1/health — Comprehensive health check
// Returns status of all services: web, ws, redis, indexer + module health + conviction stats
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getAllHealth } from '@/lib/modules/health'
import { peekCachedConviction } from '@/lib/conviction/build'

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

  // 6. Module health summary
  const moduleHealth = getAllHealth()
  const activeModules = moduleHealth.filter(h => h.status === 'active').length
  const degradedModules = moduleHealth.filter(h => h.status === 'degraded').length
  checks.modules = {
    total: moduleHealth.length,
    active: activeModules,
    degraded: degradedModules,
  }

  // 7. Conviction cache status
  const cached = peekCachedConviction()
  checks.conviction = {
    cached: cached !== null,
    markets: cached?.markets?.length ?? 0,
  }

  // 8. Conviction TTL (adaptive based on VIX)
  try {
    const { getConvictionTtl } = await import('@/lib/conviction/build')
    checks.convictionTtl = getConvictionTtl()
  } catch {
    checks.convictionTtl = -1
  }

  // 8. Backtest pending count
  try {
    const { prisma } = await import('@/lib/db')
    const pending = await prisma.backtestResult.count({ where: { outcome: 'pending' } })
    checks.backtest = { pending }
  } catch {
    checks.backtest = { pending: -1 }
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
