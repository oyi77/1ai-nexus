// ─────────────────────────────────────────────────────────────
// GET /api/v1/exchange-flow — Exchange flow intelligence
// Whale deposits, withdrawals, netflow, and alerts
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  getExchangeFlows,
  getNetFlowByExchange,
  getWhaleFlows,
  getFlowSnapshot,
} from '@/lib/modules/derived/exchange-flow-tracker'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'snapshot'

  try {
    if (action === 'flows') {
      const flows = await getExchangeFlows()
      return NextResponse.json({ data: flows, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=30' },
      })
    }

    if (action === 'net') {
      const net = await getNetFlowByExchange()
      return NextResponse.json({ data: net, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=30' },
      })
    }

    if (action === 'whale') {
      const whale = await getWhaleFlows()
      return NextResponse.json({ data: whale, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=30' },
      })
    }

    // Default: full snapshot
    const snapshot = await getFlowSnapshot()
    return NextResponse.json({ data: snapshot, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=30' },
    })
  } catch (err) {
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 502 },
    )
  }
}
