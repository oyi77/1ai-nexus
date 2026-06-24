// ─────────────────────────────────────────────────────────────
// GET /api/v1/paper-trading — Paper trading predictions
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getOpenPredictions, getClosedPredictions, getAccuracy, recordPrediction } from '@/lib/modules/derived/paper-trader'

export async function GET() {
  try {
    const open = getOpenPredictions()
    const closed = getClosedPredictions()
    const accuracy = getAccuracy()

    return NextResponse.json({
      data: { open, closed, accuracy },
      error: null,
    }, {
      headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' },
    })
  } catch (error) {
    console.error('Paper trading error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch predictions' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      symbol?: string
      direction?: string
      entryPrice?: number
      targetPrice?: number
      stopLoss?: number
      confidence?: number
      source?: string
      reasoning?: string
      ttlMinutes?: number
    }

    if (!body.symbol || !body.direction || !body.entryPrice) {
      return NextResponse.json({ data: null, error: 'symbol, direction, entryPrice required' }, { status: 400 })
    }

    const pred = recordPrediction({
      symbol: body.symbol.toUpperCase(),
      direction: body.direction as 'long' | 'short',
      entryPrice: body.entryPrice,
      targetPrice: body.targetPrice,
      stopLoss: body.stopLoss,
      confidence: body.confidence ?? 50,
      source: body.source ?? 'manual',
      reasoning: body.reasoning ?? '',
      expiresAt: Date.now() + (body.ttlMinutes ?? 60) * 60_000,
    })

    return apiJson(pred)
  } catch (error) {
    console.error('Paper trading POST error:', error)
    return NextResponse.json({ data: null, error: 'Failed to record prediction' }, { status: 502 })
  }
}