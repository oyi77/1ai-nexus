import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'
import { cacheHeaders } from '@/lib/api/response'

export async function GET() {
  const registry = registerAllModules()

  try {
    const result = await registry.fetchOne<Record<string, unknown>>(
      'sectors-app',
      { action: 'indeks' }
    )
    
    // Attempt to extract data or return raw
    return cacheHeaders(NextResponse.json({
      data: result.data || [],
      source: result.source,
      timestamp: result.timestamp
    }), 60)
  } catch (err) {
    console.error('[api/v1/sectors] Error:', err)
    return cacheHeaders(NextResponse.json({ error: String(err) }, { status: 500 }), 60)
  }
}
