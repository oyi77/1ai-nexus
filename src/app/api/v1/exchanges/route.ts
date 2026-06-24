import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getMultiExchangeTickers, getCrossExchangeFundingRates, getBinanceTickers, getBybitTickers, getOkxTickers } from '@/lib/modules/market/multi-exchange'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'tickers'
  const exchange = searchParams.get('exchange') ?? 'all'
  const symbol = searchParams.get('symbol') ?? 'BTCUSDT'
  const limit = Math.min(50, Math.max(5, Number(searchParams.get('limit') ?? 20)))

  try {
    if (action === 'funding') {
      const rates = await getCrossExchangeFundingRates(symbol)
      return NextResponse.json({ data: rates, symbol, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=30' },
      })
    }

    if (exchange !== 'all') {
      // Single exchange
      let tickers
      if (exchange === 'binance') tickers = await getBinanceTickers(limit)
      else if (exchange === 'bybit') tickers = await getBybitTickers(limit)
      else if (exchange === 'okx') tickers = await getOkxTickers(limit)
      else return NextResponse.json({ data: null, error: `Unknown exchange: ${exchange}` }, { status: 400 })

      return NextResponse.json({ data: tickers, exchange, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=15' },
      })
    }

    // All exchanges
    const allTickers = await getMultiExchangeTickers(limit)
    const result: Record<string, unknown[]> = {}
    for (const [ex, tickers] of allTickers) {
      result[ex] = tickers
    }

    return NextResponse.json({ data: result, exchanges: Object.keys(result), error: null }, {
      headers: { 'Cache-Control': 'public, max-age=15' },
    })
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 502 })
  }
}
