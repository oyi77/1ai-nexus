// ─────────────────────────────────────────────────────────────
// GET /api/v1/modules/fetch?module=<id>&...params
// Generic module data fetch endpoint
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const moduleId = searchParams.get('module')

  if (!moduleId) {
    return NextResponse.json({ error: 'module parameter required' }, { status: 400 })
  }

  const params: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    if (key !== 'module') params[key] = value
  })

  try {
    const result = await registry.fetchOne(moduleId, params)
    return NextResponse.json({
      data: result.data,
      source: result.source,
      cached: result.cached,
      timestamp: result.timestamp,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
