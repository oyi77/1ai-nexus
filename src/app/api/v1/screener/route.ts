import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { SCREENER_STOCKS } from '@/lib/config/universe'
import { getIdxUniverse } from '@/lib/modules/market/provider/idx-universe'
import { getScreenerSnapshot } from '@/lib/modules/market/provider/idx-screener'

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

  const snapshot = await getScreenerSnapshot().catch(() => null)
  let idrToUsd: number | null = null
  if (minMarketCap && filtered.some(stock => stock.exchange === 'IDX')) {
    try {
      const fxRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4400'}/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=IDRUSD=X`,
        {
          signal: AbortSignal.timeout(4_000),
          headers: { Authorization: `Bearer ${process.env.NEXUS_API_KEYS?.split(',')[0] ?? ''}` },
        },
      )
      const fxData = fxRes.ok ? await fxRes.json() : null
      const rate = fxData?.data?.[0]?.regularMarketPrice
      idrToUsd = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null
    } catch { /* unavailable FX keeps all snapshot candidates eligible */ }
  }

  const candidates = filtered.filter(stock => {
    const row = stock.exchange === 'IDX' ? snapshot?.data[stock.symbol.replace(/\.JK$/, '')] : undefined
    if (!row) return true
    if (minMarketCap && idrToUsd != null && row.marketCap != null && row.marketCap * idrToUsd < minMarketCap) return false
    if (maxPE && row.per != null && row.per > maxPE) return false
    return true
  })
  const snapshotSortKeys: Record<string, 'marketCap' | 'volume' | 'per' | 'price' | 'change1d'> = {
    marketCap: 'marketCap', volume: 'volume', pe: 'per', price: 'price', changePercent: 'change1d',
  }
  const snapshotSortKey = snapshotSortKeys[sortBy]
  const ranked = candidates.filter(stock => stock.exchange === 'IDX' && snapshot?.data[stock.symbol.replace(/\.JK$/, '')])
  ranked.sort((a, b) => {
    const aRow = snapshot!.data[a.symbol.replace(/\.JK$/, '')]
    const bRow = snapshot!.data[b.symbol.replace(/\.JK$/, '')]
    const av = snapshotSortKey ? Number(aRow[snapshotSortKey]) || 0 : 0
    const bv = snapshotSortKey ? Number(bRow[snapshotSortKey]) || 0 : 0
    if (av !== bv) return sortOrder === 'desc' ? bv - av : av - bv
    return a.symbol.localeCompare(b.symbol)
  })
  const unranked = candidates.filter(stock => !ranked.includes(stock))
  const quoteScopeSize = Math.min(candidates.length, Math.max(50, limit * 2))
  const quoteUniverse = [...unranked, ...ranked].slice(0, quoteScopeSize)
  const currencies = new Set(quoteUniverse.map(stock => EXCHANGE_CURRENCY[stock.exchange] ?? 'USD'))
  const fxSymbols = Object.entries(FX_SYMBOL_BY_CURRENCY).filter(([currency]) => currencies.has(currency)).map(([, symbol]) => symbol)
  const symbols = [...new Set([...quoteUniverse.map(s => s.symbol), ...fxSymbols])].join(',')
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

    const results: ScreenerResult[] = quoteUniverse.map(stock => {
      const q = quoteMap[stock.symbol] ?? {}
      const row = stock.exchange === 'IDX' ? snapshot?.data[stock.symbol.replace(/\.JK$/, '')] : undefined
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
        marketCap: usd(q.marketCap ?? row?.marketCap ?? null, currency),
        volume: (q.regularMarketVolume as number) ?? null,
        pe: (q.trailingPE as number) ?? row?.per ?? null,
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
      if (av !== bv) return sortOrder === 'desc' ? bv - av : av - bv
      return a.symbol.localeCompare(b.symbol)
    })

    // Limit
    finalResults = finalResults.slice(0, limit)

    const notices: string[] = []
    if (sortBy === 'dividend') notices.push('Dividend data unavailable in snapshot; results reflect live quotes on initial candidate pool')
    if (minDividend) notices.push('Dividend filtering is evaluated only against the bounded live-quoted subset')
    if (snapshotSortKey && unranked.length > 0 && ranked.length > 0) {
      notices.push('Snapshot ranking is partial; results reflect live quotes on bounded candidate pool')
    }

    return apiJson({
      results: finalResults,
      count: finalResults.length,
      filters: { sector, exchange, minMarketCap, maxPE, minDividend, sortBy, sortOrder, limit },
      notice: notices.length > 0 ? notices.join(' ') : undefined,
      quoteScope: {
        mode: snapshotSortKey && ranked.length === candidates.length && ranked.length > 0 ? 'snapshot-ranked' : 'bounded',
        considered: quoteScopeSize,
        available: filtered.length,
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=240' },
    })
  } catch (err) {
    const quoteError = (err as Error).message
    if (currencies.has('IDR') && snapshot) {
      try {
        const fxRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4400'}/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=IDRUSD=X`, { signal: AbortSignal.timeout(4_000) }).catch(() => null)
        const fxData = fxRes?.ok ? await fxRes.json() : null
        const fxRate = fxData?.data?.[0]?.regularMarketPrice
        const idrToUsd = typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null
        const usd = (value: number | null) => value != null && idrToUsd != null ? value * idrToUsd : null
        let results: ScreenerResult[] = filtered.flatMap((stock) => {
          const row = snapshot.data[stock.symbol.replace(/\.JK$/, '')]
          if (!row) return []
          return [{
            symbol: stock.symbol,
            name: row.name || stock.name,
            sector: stock.sector,
            exchange: stock.exchange,
            currency: 'USD',
            price: usd(row.price),
            change: null,
            changePercent: row.change1d,
            marketCap: usd(row.marketCap),
            volume: row.volume,
            pe: row.per,
            dividend: null,
          }]
        })
        if (minMarketCap) results = results.filter(r => r.marketCap != null && r.marketCap >= minMarketCap)
        if (maxPE) results = results.filter(r => r.pe != null && r.pe <= maxPE)
        if (minDividend) results = results.filter(r => r.dividend != null && r.dividend >= minDividend)
        results.sort((a, b) => {
          const av = Number((a as unknown as Record<string, unknown>)[sortBy]) || 0
          const bv = Number((b as unknown as Record<string, unknown>)[sortBy]) || 0
          return sortOrder === 'desc' ? bv - av : av - bv
        })
        results = results.slice(0, limit)
        if (results.length > 0) {
          return apiJson({
            results,
            count: results.length,
            notice: 'Live quotes unavailable; showing IDX snapshot',
            snapshot: { source: snapshot.source, capturedAt: snapshot.capturedAt, fxAvailable: idrToUsd != null },
            filters: { sector, exchange, minMarketCap, maxPE, minDividend, sortBy, sortOrder, limit },
          }, {
            error: quoteError,
            headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=240' },
          })
        }
      } catch { /* retain empty degradation when no snapshot exists */ }
    }
    return apiJson({
      results: [],
      count: 0,
      notice: 'Screener quotes temporarily unavailable',
      filters: { sector, exchange, minMarketCap, maxPE, minDividend, sortBy, sortOrder, limit },
    }, {
      error: quoteError,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
