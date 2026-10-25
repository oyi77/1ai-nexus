import { afterEach, describe, expect, it, vi } from 'vitest'
import deribitOptions from '../derivatives/deribit/options'
import cycleIndicators from '../chain/cycle-indicators'
import { readFileSync } from 'node:fs'
import yahooFinance from '../equities/yahoo/quotes'
import { formatCompact, formatPercent, formatPrice } from '@/lib/format'
import { NextRequest } from 'next/server'
import { GET as getScreener } from '@/app/api/v1/screener/route'

vi.mock('@/lib/modules/market/provider/idx-universe', () => ({
  getIdxUniverse: vi.fn(async () => ({ stocks: [] })),
}))

vi.mock('@/lib/modules/market/provider/idx-screener', () => ({
  getScreenerSnapshot: vi.fn(async () => ({ capturedAt: '', source: 'test', total: 0, count: 0, data: {} })),
}))

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workstream A rendered content regressions', () => {
  it('rejects aggregate fallback data for options-chain consumers', async () => {
    await expect(deribitOptions.fallbackFn!({ action: 'options-chain' })).rejects.toThrow('options chain unavailable')
  })

  it('rejects an empty options chain instead of rendering a false zero-valued chain', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('get_index_price')) return jsonResponse({ result: { index_price: 100_000 } })
      if (url.includes('get_instruments')) return jsonResponse({ result: [] })
      throw new Error(`Unexpected request: ${url}`)
    }))

    await expect(deribitOptions.fetch({ action: 'options-chain', currency: 'ETH' })).rejects.toThrow('options chain unavailable')
  })

  it('keeps holder-dependent cycle metrics unavailable while computing market-cap ratios', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/global')) {
        return jsonResponse({ data: { total_market_cap: { usd: 4_000_000_000_000 }, market_cap_change_percentage_24h_usd: 0, active_cryptocurrencies: 1, markets: 1 } })
      }
      if (url.includes('/coins/bitcoin')) {
        return jsonResponse({ market_data: { market_cap: { usd: 2_000_000_000_000 }, fully_diluted_valuation: { usd: 2_100_000_000_000 }, current_price: { usd: 100_000 }, total_supply: 21_000_000, circulating_supply: 20_000_000 } })
      }
      return jsonResponse([{ market_cap: 200_000_000_000 }])
    }))
    const result = await cycleIndicators.fetch<{ indicators: { mvrv: { value: number | null; zone: string; raw: { marketCap?: number } }; nupl: { value: number | null; zone: string }; ssr: { value: number }; dominance: { value: number } } }>({ action: 'current' })
    expect(result.data.indicators.mvrv).toMatchObject({ value: null, zone: 'unavailable', raw: { marketCap: 2_000_000_000_000 } })
    expect(result.data.indicators.nupl).toMatchObject({ value: null, zone: 'unavailable' })
    expect(result.data.indicators.ssr.value).toBe(10)
    expect(result.data.indicators.dominance.value).toBe(5)
  })

  it('does not render non-finite numbers as NaN or Infinity', () => {
    expect(formatPrice(Number.NaN)).toBe('—')
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
    expect(formatCompact(Number.NEGATIVE_INFINITY)).toBe('—')
    expect(formatCompact(-2_500_000_000)).toBe('-2.5B')
  })

  it('maps Yahoo fundamentals and keeps unavailable values null', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v8/finance/chart/')) return jsonResponse({ chart: { result: [{ meta: { symbol: 'AAPL', regularMarketPrice: 200, regularMarketVolume: 42, fiftyTwoWeekHigh: 220, fiftyTwoWeekLow: 150 } }] } })
      if (url.includes('/ws/fundamentals-timeseries/')) {
        const values: Record<string, number> = { trailingTotalRevenue: 400_000_000_000, trailingNetIncome: 100_000_000_000, annualTotalRevenue: 320_000_000_000, annualStockholdersEquity: 50_000_000_000, annualTotalDebt: 25_000_000_000, trailingPeRatio: 20, trailingPsRatio: 10 }
        return jsonResponse({ timeseries: { result: Object.entries(values).map(([type, raw]) => ({ meta: { type: [type] }, [type]: type === 'annualTotalRevenue' ? [{ reportedValue: { raw: 256_000_000_000 } }, { reportedValue: { raw } }] : [{ reportedValue: { raw } }] })) } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await yahooFinance.fetch<Record<string, unknown>[]>({ action: 'fundamentals', symbols: 'AAPL' })
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ symbol: 'AAPL', totalRevenue: 400_000_000_000, netIncomeToCommon: 100_000_000_000, revenueGrowth: 0.25, totalEquity: 50_000_000_000, debtToEquity: 50, trailingPE: 20, priceToSalesTrailing12Months: 10 })
    expect(result.data[0].enterpriseValue).toBeNull()
  })

  it('uses total crypto cap for the total summary instead of the duplicate BTC value', () => {
    const source = readFileSync('src/app/cycle-indicators/content.tsx', 'utf8')
    expect(source).toContain("label: 'Total Crypto Market Cap'")
    expect(source).toContain('value: indicators.dominance.raw.marketCap')
  })

  it('normalizes every screener currency with Yahoo USD-per-unit FX rates', async () => {
    const quotes = [
      { symbol: 'AAPL', currency: 'USD', regularMarketPrice: 200, marketCap: 3_000_000_000_000 },
      { symbol: 'BBCA.JK', currency: 'IDR', regularMarketPrice: 8000, marketCap: 1_600_000_000_000 },
      { symbol: 'SAP.DE', currency: 'EUR', regularMarketPrice: 100, marketCap: 200 },
      { symbol: '7203.T', currency: 'JPY', regularMarketPrice: 2000, marketCap: 300 },
      { symbol: '0700.HK', currency: 'HKD', regularMarketPrice: 80, marketCap: 400 },
      { symbol: 'IDRUSD=X', regularMarketPrice: 0.0000625 },
      { symbol: 'EURUSD=X', regularMarketPrice: 1.25 },
      { symbol: 'JPYUSD=X', regularMarketPrice: 0.01 },
      { symbol: 'HKDUSD=X', regularMarketPrice: 0.125 },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: quotes })))

    const response = await getScreener(new NextRequest('http://localhost/api/v1/screener'))
    const body = await response.json()
    const rows = new Map(body.data.results.map((row: { symbol: string }) => [row.symbol, row]))

    expect(response.status).toBe(200)
    expect(rows.get('AAPL')).toMatchObject({ currency: 'USD', price: 200, marketCap: 3_000_000_000_000 })
    expect(rows.get('BBCA.JK')).toMatchObject({ currency: 'USD', price: 0.5, marketCap: 100_000_000 })
    expect(rows.get('SAP.DE')).toMatchObject({ currency: 'USD', price: 125, marketCap: 250 })
    expect(rows.get('7203.T')).toMatchObject({ currency: 'USD', price: 20, marketCap: 3 })
    expect(rows.get('0700.HK')).toMatchObject({ currency: 'USD', price: 10, marketCap: 50 })
  })

  it('degrades screener quote timeouts without fabricating rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('The operation was aborted due to timeout') }))

    const response = await getScreener(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      results: [],
      count: 0,
      notice: 'Screener quotes temporarily unavailable',
      filters: { exchange: 'IDX', limit: 5 },
    })
    expect(body.error).toBe('The operation was aborted due to timeout')
  })
})
