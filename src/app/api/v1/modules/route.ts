// ─────────────────────────────────────────────────────────────
// GET /api/v1/modules — Module health + status dashboard
// Query params: ?q=search&category=macro&sourceType=public-api&status=active
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.toLowerCase()
  const category = searchParams.get('category')
  const sourceType = searchParams.get('sourceType')
  const status = searchParams.get('status')

  const registry = registerAllModules()
  let statuses = registry.getModuleStatus()

  // Apply filters
  if (q) {
    statuses = statuses.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q)
    )
  }
  if (category) {
    statuses = statuses.filter(m => m.category === category)
  }
  if (sourceType) {
    statuses = statuses.filter(m => m.sourceType === sourceType)
  }
  if (status) {
    statuses = statuses.filter(m => m.status === status)
  }

  const r = NextResponse.json({
    count: statuses.length,
    total: registry.getModuleStatus().length,
    modules: statuses.map(m => ({
      id: m.id,
      name: m.name,
      category: m.category,
      sourceType: m.sourceType,
      status: m.status,
      provenance: m.provenance,
      lastChecked: m.lastChecked?.toISOString(),
      lastSuccess: m.lastSuccess?.toISOString(),
      failureCount: m.failureCount,
      notes: m.notes,
    })),
  })
  r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  return r
}
