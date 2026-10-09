// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/stockbit-orderbook?symbol=BBCA
// Raw IDX order-book ladder from Stockbit exodus
// (/company-price-feed/v2/orderbook/companies/{SYM} — RE doc §5).
// Session-staged Bearer via idx-stockbit client; cached 15s.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { resolveStockbitAccessToken } from '@/lib/modules/market/provider/idx-stockbit/session'

const EXODUS = 'https://exodus.stockbit.com'
const CACHE_TTL_MS = 15_000

let cache: { ts: number; payload: Record<string, unknown> } | null = null

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get('symbol') ?? '')
    .toUpperCase()
    .replace(/\.JK$/, '')
  if (!symbol) {
    return NextResponse.json({ data: null, error: 'symbol required' }, { status: 400 })
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS && cache.payload.symbol === symbol) {
    return NextResponse.json({ data: cache.payload, error: null })
  }

  try {
    const session = { accessToken: await resolveStockbitAccessToken() }
    const res = await fetch(`${EXODUS}/company-price-feed/v2/orderbook/companies/${symbol}`, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        accept: 'application/json',
        'User-Agent': 'curl/8.5.0',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return NextResponse.json(
        { data: null, error: `exodus ${res.status}` },
        { status: 502 },
      )
    }
    const json = (await res.json()) as { data?: Record<string, unknown> }
    const data = json.data ?? null
    if (data) cache = { ts: Date.now(), payload: data }
    return NextResponse.json({ data, error: null })
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : 'orderbook fetch failed' },
      { status: 502 },
    )
  }
}
