import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCopyTradeSignals, generateCopyTradeSignals, getSignalStats } from '@/lib/modules/derived/copy-trade'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'signals'
  const chain = searchParams.get('chain') ?? undefined
  const limit = Math.min(50, Math.max(5, Number(searchParams.get('limit') ?? 20)))

  try {
    if (action === 'generate') {
      const signals = await generateCopyTradeSignals()
      return NextResponse.json({ data: signals, count: signals.length }, {
        headers: { 'Cache-Control': 'public, max-age=30' },
      })
    }

    if (action === 'stats') {
      const stats = getSignalStats()
      return NextResponse.json({ data: stats }, {
        headers: { 'Cache-Control': 'public, max-age=10' },
      })
    }

    // Default: return recent signals
    let signals = await getCopyTradeSignals({ maxSignals: limit })
    if (chain) {
      signals = signals.filter(s => s.chain === chain)
    }

    return NextResponse.json({ data: signals, count: signals.length }, {
      headers: { 'Cache-Control': 'public, max-age=10' },
    })
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 502 })
  }
}
