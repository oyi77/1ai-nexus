import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'
import { getAllHealth } from '@/lib/modules/health'
import { checkAllFeeds } from '@/lib/feed-health'
import { stats as latencyStats } from '@/lib/telemetry'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const registry = registerAllModules()
    const modules = registry.getAll()
    const healthEntries = getAllHealth()
    const healthMap = new Map(healthEntries.map((h) => [h.moduleId, h]))

    const moduleHealth = modules.map((m) => {
      const h = healthMap.get(m.id)
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        sourceType: m.sourceType,
        enabled: m.isEnabled(),
        status: h?.status ?? 'unknown',
        lastChecked: h?.lastChecked,
        lastSuccess: h?.lastSuccess,
        failureCount: h?.failureCount ?? 0,
        notes: h?.notes,
        fragile: m.provenance.fragility,
      }
    })

    const feedReport = await checkAllFeeds()

    const latency = latencyStats()

    const byCategory: Record<string, { total: number; active: number; degraded: number; offline: number }> = {}
    for (const m of moduleHealth) {
      const c = byCategory[m.category] ?? { total: 0, active: 0, degraded: 0, offline: 0 }
      c.total++
      if (m.status === 'active') c.active++
      else if (m.status === 'degraded') c.degraded++
      else c.offline++
      byCategory[m.category] = c
    }

    return NextResponse.json({
      data: {
        generated: new Date().toISOString(),
        modules: {
          total: moduleHealth.length,
          active: moduleHealth.filter((m) => m.status === 'active').length,
          degraded: moduleHealth.filter((m) => m.status === 'degraded').length,
          offline: moduleHealth.filter((m) => m.status === 'offline').length,
          byCategory,
          items: moduleHealth,
        },
        feeds: {
          total: feedReport.total,
          working: feedReport.working,
          dead: feedReport.dead,
          atomOnly: feedReport.atomOnly,
          items: feedReport.feeds,
        },
        latency: {
          tracked: latency.length,
          items: latency,
        },
      },
      error: null,
    }, { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } })
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 })
  }
}
