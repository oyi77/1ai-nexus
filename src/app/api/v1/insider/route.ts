import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { scanForInsiderSignals } from '@/lib/modules/derived/insider-detector'

export async function GET() {
  try {
    const signals = await scanForInsiderSignals()
    return NextResponse.json({ data: signals, count: signals.length, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
    })
  } catch (err) {
    return NextResponse.json({ data: [], error: (err as Error).message }, { status: 502 })
  }
}
