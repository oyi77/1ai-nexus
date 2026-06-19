// ─────────────────────────────────────────────────────────────
// GET /api/v1/modules — Module health + status dashboard
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  const registry = registerAllModules()
  const statuses = registry.getModuleStatus()

  return NextResponse.json({
    count: statuses.length,
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
}
