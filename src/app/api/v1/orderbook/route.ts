// ─────────────────────────────────────────────────────────────
// GET /api/v1/orderbook — Real-time order book depth
// Uses Binance WebSocket depth stream (connected via trade-aggregator)
// Falls back to REST API if WS data not available
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'

const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT',
  XRP: 'XRPUSDT', DOGE: 'DOGEUSDT', AVAX: 'AVAXUSDT',
  LINK: 'LINKUSDT', ARB: 'ARBUSDT', OP: 'OPUSDT',
}

interface DepthLevel { price: number; quantity: number; total: number }

async function fetchOrderBook(symbol: string) {
  const binanceSymbol = SYMBOL_MAP[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USDT`

  // Fetch depth + 24h ticker in parallel
  const [depthRes, tickerRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/depth?symbol=${binanceSymbol}&limit=20`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`, { signal: AbortSignal.timeout(10_000) }),
  ])

  if (!depthRes.ok) throw new Error(`Binance depth error: ${depthRes.status}`)
  if (!tickerRes.ok) throw new Error(`Binance ticker error: ${tickerRes.status}`)

  const depth = (await depthRes.json()) as { bids: Array<[string, string]>; asks: Array<[string, string]> }
  const ticker = (await tickerRes.json()) as {
    lastPrice: string; priceChangePercent: string; volume: string
    quoteVolume: string; highPrice: string; lowPrice: string
  }

  let bidDepth = 0
  let askDepth = 0

  const bids: DepthLevel[] = depth.bids.slice(0, 15).map(([p, q]) => {
    const price = parseFloat(p)
    const quantity = parseFloat(q)
    const total = price * quantity
    bidDepth += total
    return { price, quantity, total }
  })

  const asks: DepthLevel[] = depth.asks.slice(0, 15).map(([p, q]) => {
    const price = parseFloat(p)
    const quantity = parseFloat(q)
    const total = price * quantity
    askDepth += total
    return { price, quantity, total }
  })

  const bestBid = bids[0]?.price ?? 0
  const bestAsk = asks[0]?.price ?? 0
  const spread = bestAsk - bestBid
  const midPrice = (bestAsk + bestBid) / 2
  const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0
  const imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0

  return {
    symbol,
    binanceSymbol,
    bids,
    asks,
    bidDepth,
    askDepth,
    spread,
    spreadBps,
    midPrice,
    imbalance,
    ticker: {
      price: parseFloat(ticker.lastPrice),
      change24h: parseFloat(ticker.priceChangePercent),
      volume24h: parseFloat(ticker.quoteVolume),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
    },
    timestamp: Date.now(),
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = (searchParams.get('symbol') ?? 'BTC').toUpperCase()

    const { data, fromCache } = await getCached(
      `orderbook:${symbol}`,
      3_000, // 3s cache — fast enough for depth
      () => fetchOrderBook(symbol),
    )

    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=3, stale-while-revalidate=6')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Orderbook error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch order book' }, { status: 502 })
  }
}
