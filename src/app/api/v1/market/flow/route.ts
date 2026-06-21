import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  try {
    const registry = registerAllModules()
    const res = await registry.fetchOne<any>('market-flow', { action: 'get' })
    return NextResponse.json(res.data, {
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' },
    })
  } catch (err) {
    console.error('[api/v1/market/flow] Error:', err)
    return NextResponse.json({ flows: [], summary: null, error: String(err) }, { status: 502 })
  }
}
