// ─────────────────────────────────────────────────────────────
// GET /api/v1/modules/fetch?module=<id>&...params
// Generic module data fetch endpoint
// Export: ?format=csv|json (default json)
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'
import { cacheHeaders } from '@/lib/api/response'

function toCsv(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) return ''
  const rows = data as Record<string, unknown>[]
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','))
  }
  return lines.join('\n')
}

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const moduleId = searchParams.get('module')
  const format = searchParams.get('format') || 'json'

  if (!moduleId) {
    return cacheHeaders(NextResponse.json({ error: 'module parameter required' }, { status: 400 }), 60)
  }

  const params: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    if (key !== 'module' && key !== 'format') params[key] = value
  })

  try {
    const result = await registry.fetchOne(moduleId, params)
    if (format === 'csv') {
      const csv = toCsv(result.data)
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${moduleId}.csv"`,
          ...cacheHeaders(NextResponse.next(), 60).headers,
        },
      })
    }
    return cacheHeaders(NextResponse.json({
      data: result.data,
      source: result.source,
      cached: result.cached,
      timestamp: result.timestamp,
    }), 60)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return cacheHeaders(NextResponse.json({ error: message }, { status: 500 }), 60)
  }
}
