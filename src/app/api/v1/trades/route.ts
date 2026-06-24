// ─────────────────────────────────────────────────────────────
// GET /api/v1/trades — Real-time trade flow aggregator
// Inspired by aggr.trade — connects to multiple exchange WebSockets
// Returns live buy/sell volume, net flow, VWAP per symbol
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getFlowData, getRecentTrades, startTradeAggregator } from '@/lib/modules/market/trade-aggregator'

// Start aggregator on first request (lazy init)
let started = false

export async function GET(request: Request) {
  try {
    if (!started) {
      startTradeAggregator()
      started = true
      // Wait a moment for initial trades to arrive
      await new Promise(r => setTimeout(r, 2000))
    }

    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') ?? 'flow'
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))

    if (mode === 'recent') {
      const trades = getRecentTrades(limit)
      return NextResponse.json({
        data: { trades, count: trades.length },
        error: null,
      }, {
        headers: { 'Cache-Control': 'no-cache' },
      })
    }

    // Default: flow aggregation
    const flow = getFlowData()
    return NextResponse.json({
      data: flow,
      error: null,
    }, {
      headers: { 'Cache-Control': 'no-cache' },
    })
  } catch (error) {
    console.error('Trades error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch trades' }, { status: 502 })
  }
}