import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { SCREENER_STOCKS } from '@/lib/config/universe'
import { getIdxUniverse } from '@/lib/modules/market/provider/idx-universe'

export const dynamic = 'force-dynamic'

interface ScreenerResult {
  symbol: string
  name: string
  exchange: string
  currency: 'USD'
  price: number | null
  change: number | null
  changePercent: number | null
  marketCap: number | null
  volume: number | null
  pe: number | null
  dividend: number | null
}

const EXCHANGE_CURRENCY: Record<string, string> = {
  NASDAQ: 'USD', NYSE: 'USD', IDX: 'IDR', XETRA: 'EUR', Euronext: 'EUR', TSE: 'JPY', HKEX: 'HKD',
}
const FX_SYMBOL_BY_CURRENCY: Record<string, string> = {
  IDR: 'IDRUSD=X', EUR: 'EURUSD=X', JPY: 'JPYUSD=X', HKD: 'HKDUSD=X',
}

// GET /api/v1/screener — Multi-asset stock screener
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const sector = searchParams.get('sector') ?? undefined
  const exchange = searchParams.get('exchange') ?? undefined
  const minMarketCap = searchParams.get('minMarketCap') ? Number(searchParams.get('minMarketCap')) : undefined
  const maxPE = searchParams.get('maxPE') ? Number(searchParams.get('maxPE')) : undefined
  const minDividend = searchParams.get('minDividend') ? Number(searchParams.get('minDividend')) : undefined
  const sortBy = searchParams.get('sortBy') ?? 'marketCap'
  const sortOrder = searchParams.get('sortOrder') ?? 'desc'
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)


  // Apply filters
  const universe: Array<{ symbol: string; name: string; sector: string; exchange: string }> = [...SCREENER_STOCKS]
  if (!exchange || exchange.toLowerCase() === 'idx') {
    try {
      // Bound discovery so discovery + quotes cannot exceed public proxy deadlines.
      const { stocks } = await Promise.race([
        getIdxUniverse(),
        new Promise<{ stocks: [] }>(resolve => setTimeout(() => resolve({ stocks: [] }), 6_000)),
      ])
      const curated = new Set(universe.map((s) => s.symbol))
      universe.push(
        ...stocks
          .filter((s) => !curated.has(s.symbol))
          .map((s) => ({ symbol: s.symbol, name: s.name || s.symbol.replace('.JK', ''), sector: s.sector ?? 'IDX', exchange: 'IDX' })),
      )
    } catch { /* curated floor covers */ }
  }
  let filtered = universe
  if (sector) filtered = filtered.filter(s => s.sector.toLowerCase() === sector.toLowerCase())
  if (exchange) filtered = filtered.filter(s => s.exchange.toLowerCase() === exchange.toLowerCase())

  // Fetch real prices. Keep request latency below public proxy limits.
  const currencies = new Set(filtered.map(stock => EXCHANGE_CURRENCY[stock.exchange] ?? 'USD'))
  const fxSymbols = Object.entries(FX_SYMBOL_BY_CURRENCY).filter(([currency]) => currencies.has(currency)).map(([, symbol]) => symbol)
  const symbols = [...new Set([...filtered.map(s => s.symbol), ...fxSymbols])].join(',')
  try {
    const quoteRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4400'}/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`,
      {
        signal: AbortSignal.timeout(12_000),
        headers: { Authorization: `Bearer ${process.env.NEXUS_API_KEYS?.split(',')[0] ?? ''}` },
      }
    )
    if (!quoteRes.ok) throw new Error(`Quote source returned HTTP ${quoteRes.status}`)
    const quoteData = await quoteRes.json()
    const quoteMap: Record<string, Record<string, unknown>> = {}
    for (const q of quoteData.data ?? []) {
      if (typeof q.symbol === 'string') quoteMap[q.symbol] = q
    }
    const fxRates: Record<string, number | null> = {}
    for (const [currency, symbol] of Object.entries(FX_SYMBOL_BY_CURRENCY)) {
      if (!currencies.has(currency)) continue
      const rate = quoteMap[symbol]?.regularMarketPrice
      fxRates[currency] = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null
    }
    const usd = (value: unknown, currency: string): number | null => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      if (currency === 'USD') return value
      const rate = fxRates[currency]
      return rate == null ? null : value * rate
    }

    const results: ScreenerResult[] = filtered.map(stock => {
      const q = quoteMap[stock.symbol] ?? {}
      const currency = typeof q.currency === 'string' ? q.currency : EXCHANGE_CURRENCY[stock.exchange] ?? 'USD'
      return {
        symbol: stock.symbol,
        name: (q.shortName as string) ?? stock.name,
        sector: stock.sector,
        exchange: stock.exchange,
        currency: 'USD',
        price: usd(q.regularMarketPrice, currency),
        change: usd(q.regularMarketChange, currency),
        changePercent: (q.regularMarketChangePercent as number) ?? null,
        marketCap: usd(q.marketCap, currency),
        volume: (q.regularMarketVolume as number) ?? null,
        pe: (q.trailingPE as number) ?? null,
        dividend: (q.dividendYield as number) ?? null,
      }
    })

    // Apply post-fetch filters
    let finalResults = results
    if (minMarketCap) finalResults = finalResults.filter(r => r.marketCap != null && r.marketCap >= minMarketCap)
    if (maxPE) finalResults = finalResults.filter(r => r.pe != null && r.pe <= maxPE)
    if (minDividend) finalResults = finalResults.filter(r => r.dividend != null && r.dividend >= minDividend)

    // Sort
    finalResults.sort((a, b) => {
      const av = Number((a as unknown as Record<string, unknown>)[sortBy]) || 0
      const bv = Number((b as unknown as Record<string, unknown>)[sortBy]) || 0
      return sortOrder === 'desc' ? bv - av : av - bv
    })

    // Limit
    finalResults = finalResults.slice(0, limit)

    return apiJson({
      results: finalResults,
      count: finalResults.length,
      filters: { sector, exchange, minMarketCap, maxPE, minDividend, sortBy, sortOrder, limit },
    }, {
      headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=240' },
    })
  } catch (err) {
    return apiJson({
      results: [],
      count: 0,
      notice: 'Screener quotes temporarily unavailable',
      filters: { sector, exchange, minMarketCap, maxPE, minDividend, sortBy, sortOrder, limit },
    }, {
      error: (err as Error).message,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
