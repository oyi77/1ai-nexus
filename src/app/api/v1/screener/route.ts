import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { SCREENER_STOCKS } from '@/lib/config/universe'
import { getIdxUniverse } from '@/lib/modules/market/provider/idx-universe'

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


  // Apply filters
  const universe: Array<{ symbol: string; name: string; sector: string; exchange: string }> = [...SCREENER_STOCKS]
  if (!exchange || exchange.toLowerCase() === 'idx') {
    try {
      const { stocks } = await getIdxUniverse()
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
