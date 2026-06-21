import { NextResponse } from 'next/server'
import { fetchAlphaSignals } from '@/lib/modules/derived/alpha-feed'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(100, Math.max(5, Number(searchParams.get('limit') ?? 50)))
  const type = searchParams.get('type') ?? undefined

  try {
    let signals = await fetchAlphaSignals(limit * 2)
    if (type) {
      signals = signals.filter(s => s.type === type)
    }
    return NextResponse.json({ data: signals.slice(0, limit), count: signals.length, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' },
    })
  } catch (err) {
    return NextResponse.json({ data: [], error: (err as Error).message }, { status: 502 })
  }
}
