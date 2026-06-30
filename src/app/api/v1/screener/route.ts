import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

interface ScreenerResult {
  symbol: string
  name: string
  exchange: string
  sector: string
  price: number
  change: number
  changePercent: number
  marketCap: number
  volume: number
  pe: number | null
  dividend: number | null
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

  // All screener stocks
  const ALL_STOCKS = [
    // US Tech
    { symbol: 'AAPL', name: 'Apple', sector: 'Technology', exchange: 'NASDAQ' },
    { symbol: 'MSFT', name: 'Microsoft', sector: 'Technology', exchange: 'NASDAQ' },
    { symbol: 'GOOGL', name: 'Alphabet', sector: 'Technology', exchange: 'NASDAQ' },
    { symbol: 'AMZN', name: 'Amazon', sector: 'Technology', exchange: 'NASDAQ' },
    { symbol: 'NVDA', name: 'NVIDIA', sector: 'Technology', exchange: 'NASDAQ' },
    { symbol: 'META', name: 'Meta', sector: 'Technology', exchange: 'NASDAQ' },
    { symbol: 'TSLA', name: 'Tesla', sector: 'Automotive', exchange: 'NASDAQ' },
    { symbol: 'NFLX', name: 'Netflix', sector: 'Media', exchange: 'NASDAQ' },
    // US Financial
    { symbol: 'JPM', name: 'JPMorgan', sector: 'Financial', exchange: 'NYSE' },
    { symbol: 'GS', name: 'Goldman Sachs', sector: 'Financial', exchange: 'NYSE' },
    { symbol: 'V', name: 'Visa', sector: 'Financial', exchange: 'NYSE' },
    { symbol: 'BAC', name: 'Bank of America', sector: 'Financial', exchange: 'NYSE' },
    // US Healthcare
    { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare', exchange: 'NYSE' },
    { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', exchange: 'NYSE' },
    { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', exchange: 'NYSE' },
    // US Energy
    { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', exchange: 'NYSE' },
    { symbol: 'CVX', name: 'Chevron', sector: 'Energy', exchange: 'NYSE' },
    // IDX
    { symbol: 'BBCA.JK', name: 'Bank Central Asia', sector: 'Financial', exchange: 'IDX' },
    { symbol: 'BBRI.JK', name: 'Bank Rakyat Indonesia', sector: 'Financial', exchange: 'IDX' },
    { symbol: 'BMRI.JK', name: 'Bank Mandiri', sector: 'Financial', exchange: 'IDX' },
    { symbol: 'TLKM.JK', name: 'Telkom Indonesia', sector: 'Telecom', exchange: 'IDX' },
    { symbol: 'GOTO.JK', name: 'GoTo Gojek Tokopedia', sector: 'Technology', exchange: 'IDX' },
    { symbol: 'ADRO.JK', name: 'Adaro Energy', sector: 'Energy', exchange: 'IDX' },
    // EU
    { symbol: 'SAP.DE', name: 'SAP', sector: 'Technology', exchange: 'XETRA' },
    { symbol: 'MC.PA', name: 'LVMH', sector: 'Consumer', exchange: 'Euronext' },
    // Asia
    { symbol: '7203.T', name: 'Toyota', sector: 'Automotive', exchange: 'TSE' },
    { symbol: '0700.HK', name: 'Tencent', sector: 'Technology', exchange: 'HKEX' },
    { symbol: 'BABA', name: 'Alibaba', sector: 'Technology', exchange: 'NYSE' },
    { symbol: '005930.KS', name: 'Samsung', sector: 'Technology', exchange: 'KRX' },
    { symbol: '2330.TW', name: 'TSMC', sector: 'Technology', exchange: 'TWSE' },
  ]

  // Apply filters
  let filtered = ALL_STOCKS
  if (sector) filtered = filtered.filter(s => s.sector.toLowerCase() === sector.toLowerCase())
  if (exchange) filtered = filtered.filter(s => s.exchange.toLowerCase() === exchange.toLowerCase())

  // Fetch real prices
  const symbols = filtered.map(s => s.symbol).join(',')
  try {
    const quoteRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4400'}/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`,
      { signal: AbortSignal.timeout(30_000) }
    )
    const quoteData = await quoteRes.json()
    const quoteMap: Record<string, Record<string, unknown>> = {}
    for (const q of quoteData.data ?? []) {
      quoteMap[q.symbol as string] = q
    }

    const results: ScreenerResult[] = filtered.map(stock => {
      const q = quoteMap[stock.symbol] ?? {}
      return {
        symbol: stock.symbol,
        name: (q.shortName as string) ?? stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        price: (q.regularMarketPrice as number) ?? 0,
        change: (q.regularMarketChange as number) ?? 0,
        changePercent: (q.regularMarketChangePercent as number) ?? 0,
        marketCap: (q.marketCap as number) ?? 0,
        volume: (q.regularMarketVolume as number) ?? 0,
        pe: (q.trailingPE as number) ?? null,
        dividend: (q.dividendYield as number) ?? null,
      }
    })

    // Apply post-fetch filters
    let finalResults = results
    if (minMarketCap) finalResults = finalResults.filter(r => r.marketCap >= minMarketCap)
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
    })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 502 })
  }
}
