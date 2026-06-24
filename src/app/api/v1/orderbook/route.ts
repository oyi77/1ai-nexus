// ─────────────────────────────────────────────────────────────
// GET /api/v1/orderbook?symbol=BTC — Real-time order book depth
// Binance public API, no key required
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  DOGE: 'DOGEUSDT',
  ADA: 'ADAUSDT',
  AVAX: 'AVAXUSDT',
  LINK: 'LINKUSDT',
  DOT: 'DOTUSDT',
  MATIC: 'MATICUSDT',
  ARB: 'ARBUSDT',
  OP: 'OPUSDT',
}

async function fetchOrderBook(symbol: string) {
  const binanceSymbol = SYMBOL_MAP[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USDT`

  const [depthRes, tickerRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/depth?symbol=${binanceSymbol}&limit=20`, {
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`, {
      signal: AbortSignal.timeout(10_000),
    }),
  ])

  if (!depthRes.ok) throw new Error(`Binance depth error: ${depthRes.status}`)
  if (!tickerRes.ok) throw new Error(`Binance ticker error: ${tickerRes.status}`)

  const depth = (await depthRes.json()) as {
    bids: Array<[string, string]>
    asks: Array<[string, string]>
    lastUpdateId: number
  }

  const ticker = (await tickerRes.json()) as {
    lastPrice: string
    priceChangePercent: string
    volume: string
    quoteVolume: string
    highPrice: string
    lowPrice: string
  }

  // Calculate cumulative bid/ask depth (USD)
  let bidDepth = 0
  let askDepth = 0
  for (const [price, qty] of depth.bids) {
    bidDepth += parseFloat(price) * parseFloat(qty)
  }
  for (const [price, qty] of depth.asks) {
    askDepth += parseFloat(price) * parseFloat(qty)
  }

  const spread = parseFloat(depth.asks[0]?.[0] ?? '0') - parseFloat(depth.bids[0]?.[0] ?? '0')
  const midPrice = (parseFloat(depth.asks[0]?.[0] ?? '0') + parseFloat(depth.bids[0]?.[0] ?? '0')) / 2
  const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0

  return {
    symbol,
    binanceSymbol,
    bids: depth.bids.slice(0, 15).map(([price, qty]) => ({
      price: parseFloat(price),
      quantity: parseFloat(qty),
      total: parseFloat(price) * parseFloat(qty),
    })),
    asks: depth.asks.slice(0, 15).map(([price, qty]) => ({
      price: parseFloat(price),
      quantity: parseFloat(qty),
      total: parseFloat(price) * parseFloat(qty),
    })),
    bidDepth,
    askDepth,
    spread: spread,
    spreadBps,
    midPrice,
    ticker: {
      price: parseFloat(ticker.lastPrice),
      change24h: parseFloat(ticker.priceChangePercent),
      volume24h: parseFloat(ticker.volume),
      quoteVolume24h: parseFloat(ticker.quoteVolume),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
    },
    imbalance: bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0,
    timestamp: Date.now(),
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = (searchParams.get('symbol') ?? 'BTC').toUpperCase()

    const { data, fromCache } = await getCached(
      `orderbook:${symbol}`,
      5_000, // 5s cache for orderbook
      () => fetchOrderBook(symbol),
    )

    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=10')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Orderbook error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch order book' }, { status: 502 })
  }
}