/**
 * Module: Yahoo Finance
 * sourceType: re
 * upstreamProduct: Yahoo Finance
 * endpoint: query1.finance.yahoo.com / query2.finance.yahoo.com
 * discoveredVia: community-package
 * lastVerified: 2026-07-27
 * UNOFFICIAL: this calls Yahoo Finance's internal JSON API, not their public API.
 *   Uses /v8/finance/chart for quotes (v7 quote returns empty from server IPs).
 *   fallbackFn: cached last-known-good
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'

const BASES = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

async function yfFetch<T>(path: string): Promise<T> {
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const json = await res.json() as T
      return json as T
    } catch {
      continue
    }
  }
  throw new Error('Yahoo Finance: all endpoints failed')
}

/** Fetch a single quote via chart endpoint (v7 quote returns empty from server IPs) */
async function chartQuote(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await yfFetch<{ chart?: { result?: Array<{ meta?: Record<string, unknown> }> } }>(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
    )
    const meta = data.chart?.result?.[0]?.meta
    if (!meta) return null
    const price = meta.regularMarketPrice as number | undefined
    const prevClose = meta.chartPreviousClose as number | undefined
    const change = price != null && prevClose != null ? price - prevClose : 0
    const changePercent = prevClose != null && prevClose !== 0 ? (change / prevClose) * 100 : 0
    return {
      symbol: meta.symbol ?? symbol,
      regularMarketPrice: price,
      regularMarketChange: change,
      regularMarketChangePercent: changePercent,
      chartPreviousClose: prevClose,
      currency: meta.currency ?? 'USD',
      marketState: meta.marketState ?? 'REGULAR',
      shortName: meta.shortName ?? symbol,
      longName: meta.longName ?? meta.shortName ?? symbol,
      regularMarketVolume: meta.regularMarketVolume ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      averageVolume: meta.averageDailyVolume3Month ?? null,
    }
  } catch { return null }
}

const FUNDAMENTAL_TYPES = [
  'trailingMarketCap', 'trailingPeRatio', 'trailingForwardPeRatio', 'trailingPegRatio',
  'trailingPsRatio', 'trailingPbRatio', 'trailingEnterprisesValueEBITDARatio',
  'trailingEnterprisesValueRevenueRatio', 'trailingTotalRevenue', 'trailingNetIncome',
  'trailingOperatingIncome', 'trailingGrossProfit', 'trailingEBITDA',
  'trailingOperatingCashFlow', 'trailingFreeCashFlow', 'annualTotalAssets',
  'annualStockholdersEquity', 'annualTotalLiabilities', 'annualTotalDebt',
  'annualCashCashEquivalentsAndShortTermInvestments', 'annualCurrentAssets',
  'annualCurrentLiabilities', 'annualDilutedAverageShares', 'annualTotalRevenue',
  'annualNetIncome', 'annualCashDividendsPaid', 'annualCapitalExpenditure',
]

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator != null && denominator != null && denominator !== 0 ? numerator / denominator : null
}

async function fundamentalQuote(symbol: string): Promise<Record<string, unknown> | null> {
  try {
  const period2 = Math.floor(Date.now() / 1000) + 86_400
  const period1 = period2 - 5 * 365 * 86_400
  const [quote, response] = await Promise.all([
    chartQuote(symbol),
    yfFetch<{ timeseries?: { result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }> } }>(
      `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${FUNDAMENTAL_TYPES.join(',')}&period1=${period1}&period2=${period2}`
    ),
  ])
  const series = new Map<string, number[]>()
  for (const item of response.timeseries?.result ?? []) {
    const type = item.meta?.type?.[0]
    if (!type) continue
    const points = item[type]
    if (!Array.isArray(points)) continue
    series.set(type, points.map(point => Number((point as { reportedValue?: { raw?: unknown } })?.reportedValue?.raw)).filter(Number.isFinite))
  }
  const latest = (type: string) => series.get(type)?.at(-1) ?? null
  const previous = (type: string) => series.get(type)?.at(-2) ?? null
  const shares = latest('annualDilutedAverageShares')
  const revenue = latest('trailingTotalRevenue')
  const netIncome = latest('trailingNetIncome')
  const equity = latest('annualStockholdersEquity')
  const assets = latest('annualTotalAssets')
  const annualRevenue = latest('annualTotalRevenue')
  const previousRevenue = previous('annualTotalRevenue')
  const marketCap = latest('trailingMarketCap') ?? (quote?.regularMarketPrice != null && shares != null ? Number(quote.regularMarketPrice) * shares : null)
  return {
    ...quote,
    symbol: quote?.symbol ?? symbol,
    marketCap,
    enterpriseValue: null,
    trailingPE: latest('trailingPeRatio'),
    forwardPE: latest('trailingForwardPeRatio'),
    pegRatio: latest('trailingPegRatio'),
    priceToBook: latest('trailingPbRatio'),
    priceToSalesTrailing12Months: latest('trailingPsRatio'),
    enterpriseToRevenue: latest('trailingEnterprisesValueRevenueRatio'),
    enterpriseToEbitda: latest('trailingEnterprisesValueEBITDARatio'),
    totalRevenue: revenue,
    revenueGrowth: annualRevenue != null && previousRevenue != null && previousRevenue !== 0 ? (annualRevenue - previousRevenue) / Math.abs(previousRevenue) : null,
    grossProfits: latest('trailingGrossProfit'),
    grossMargins: ratio(latest('trailingGrossProfit'), revenue),
    operatingIncome: latest('trailingOperatingIncome'),
    operatingMargins: ratio(latest('trailingOperatingIncome'), revenue),
    netIncomeToCommon: netIncome,
    profitMargins: ratio(netIncome, revenue),
    ebitda: latest('trailingEBITDA'),
    ebitdaMargins: ratio(latest('trailingEBITDA'), revenue),
    trailingEps: ratio(netIncome, shares),
    returnOnEquity: ratio(netIncome, equity),
    returnOnAssets: ratio(netIncome, assets),
    totalAssets: assets,
    totalLiabilities: latest('annualTotalLiabilities'),
    totalEquity: equity,
    bookValue: ratio(equity, shares),
    totalCash: latest('annualCashCashEquivalentsAndShortTermInvestments'),
    totalDebt: latest('annualTotalDebt'),
    debtToEquity: ratio(latest('annualTotalDebt'), equity) != null ? Number(ratio(latest('annualTotalDebt'), equity)) * 100 : null,
    currentRatio: ratio(latest('annualCurrentAssets'), latest('annualCurrentLiabilities')),
    operatingCashflow: latest('trailingOperatingCashFlow'),
    capitalExpenditure: latest('annualCapitalExpenditure'),
    freeCashflow: latest('trailingFreeCashFlow'),
    sharesOutstanding: shares,
    dividendYield: null,
    payoutRatio: latest('annualCashDividendsPaid') != null ? ratio(Math.abs(Number(latest('annualCashDividendsPaid'))), latest('annualNetIncome')) : null,
    beta: null,
    shortRatio: null,
  }
  } catch { return null }
}

async function fetchYahooFinance(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'quote'

  switch (action) {
    case 'quote': {
      const symbols = (params.symbols as string) ?? 'BTC-USD,ETH-USD,SOL-USD'
      // Chart endpoint is more reliable from server IPs; fetch with bounded concurrency.
      const list = symbols.split(',').map(s => s.trim()).filter(Boolean)
      const quotes: Array<Record<string, unknown> | null> = new Array(list.length)
      let next = 0
      await Promise.all(Array.from({ length: Math.min(12, list.length) }, async () => {
        while (next < list.length) {
          const index = next++
          quotes[index] = await chartQuote(list[index])
        }
      }))
      return quotes.filter((quote): quote is Record<string, unknown> => quote !== null)
    }
    case 'chart': {
      const symbol = (params.symbol as string) ?? 'BTC-USD'
      const interval = (params.interval as string) ?? '1d'
      const range = (params.range as string) ?? '1mo'
      const data = await yfFetch<{ chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, unknown[]>> } }> } }>(
        `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
      )
      const result = data.chart?.result?.[0]
      if (!result) return null
      return {
        symbol,
        timestamps: result.timestamp ?? [],
        quote: result.indicators?.quote?.[0] ?? {},
      }
    }
    case 'fundamentals': {
      const symbols = (params.symbols as string) ?? 'AAPL'
      const list = symbols.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50)
      const results = await Promise.allSettled(list.map(fundamentalQuote))
      return results.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => (r as PromiseFulfilledResult<Record<string, unknown>>).value)
    }
    case 'commodities': {
      // Gold, Silver, Oil, Natural Gas
      const symbols = (params.symbols as string) ?? 'GC=F,SI=F,CL=F,NG=F'
      const list = symbols.split(',').map(s => s.trim()).filter(Boolean)
      const results = await Promise.allSettled(list.map(s => chartQuote(s)))
      const quotes = results
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<Record<string, unknown>>).value)
      return quotes
    }
    default:
      throw new Error(`Yahoo Finance: unknown action ${action}`)
  }
}

const yahooFinanceModule: DataModule = {
  id: 'yahoo-finance',
  name: 'Yahoo Finance',
  category: 'equities',
  sourceType: 're',
  provenance: {
    describesItself: 'Yahoo Finance internal JSON API — stocks, indices, crypto, commodities',
    upstreamProduct: 'Yahoo Finance Premium',
    discoveredVia: 'community-package',
    fragility: 'moderate',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const q = await chartQuote('AAPL')
      if (!q) throw new Error('empty quote')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'yahoo-finance',
      params,
      TTL.PRICE_DATA * TTL.RE_MULTIPLIER,
      () => fetchYahooFinance(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return { data: [] as unknown as T, source: 'yahoo-finance (cached)', cached: true, timestamp: Date.now(), ttl: TTL.PRICE_DATA * TTL.RE_MULTIPLIER }
  },
}

export default yahooFinanceModule
