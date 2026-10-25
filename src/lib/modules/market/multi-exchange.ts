// ─────────────────────────────────────────────────────────────
// Multi-Exchange Aggregator — Binance, Bybit, OKX
// Free public APIs, no auth required
// Source: 1ai-trade-cex (trading_bot/exchange/ccxt.py)
// ─────────────────────────────────────────────────────────────

export interface ExchangeTicker {
  exchange: string
  symbol: string
  price: number
  priceChange24h: number
  volume24h: number // quote-value turnover in USD/USDT, not base-asset units
  high24h: number
  low24h: number
}

export interface ExchangeFundingRate {
  exchange: string
  symbol: string
  rate: number
  nextTime: number
}

const EXCHANGES = {
  binance: {
    ticker: 'https://api.binance.com/api/v3/ticker/24hr',
    funding: 'https://fapi.binance.com/fapi/v1/fundingRate',
    oi: 'https://fapi.binance.com/fapi/v1/openInterest',
  },
  bybit: {
    ticker: 'https://api.bybit.com/v5/market/tickers?category=linear',
    funding: 'https://api.bybit.com/v5/market/funding/history?category=linear',
    oi: 'https://api.bybit.com/v5/market/open-interest?category=linear',
  },
  okx: {
    ticker: 'https://www.okx.com/api/v5/market/tickers?instType=SWAP',
    funding: 'https://www.okx.com/api/v5/public/funding-rate?instType=SWAP',
    oi: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP',
  },
} as const

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function getBinanceTickers(limit = 20): Promise<ExchangeTicker[]> {
  try {
    const data = await fetchJson<Array<{ symbol: string; lastPrice: string; priceChangePercent: string; volume: string; quoteVolume: string; highPrice: string; lowPrice: string }>>(EXCHANGES.binance.ticker)
    return data
      .filter(t => t.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(t => ({
        exchange: 'binance',
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        priceChange24h: parseFloat(t.priceChangePercent),
        volume24h: parseFloat(t.quoteVolume),
        high24h: parseFloat(t.highPrice),
        low24h: parseFloat(t.lowPrice),
      }))
  } catch {
    return []
  }
}

export async function getBybitTickers(limit = 20): Promise<ExchangeTicker[]> {
  try {
    const data = await fetchJson<{ result: { list: Array<{ symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string; highPrice24h: string; lowPrice24h: string }> } }>(EXCHANGES.bybit.ticker)
    return data.result.list
      .filter(t => t.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
      .slice(0, limit)
      .map(t => ({
        exchange: 'bybit',
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        priceChange24h: parseFloat(t.price24hPcnt) * 100,
        volume24h: parseFloat(t.turnover24h),
        high24h: parseFloat(t.highPrice24h),
        low24h: parseFloat(t.lowPrice24h),
      }))
  } catch {
    return []
  }
}

export async function getOkxTickers(limit = 20): Promise<ExchangeTicker[]> {
  try {
    const data = await fetchJson<{ data: Array<{ instId: string; last: string; sodUtc8: string; vol24h: string; volCcy24h: string; high24h: string; low24h: string }> }>(EXCHANGES.okx.ticker)
    return data.data
      .filter(t => t.instId.endsWith('-USDT-SWAP'))
      .sort((a, b) => parseFloat(b.volCcy24h) - parseFloat(a.volCcy24h))
      .slice(0, limit)
      .map(t => ({
        exchange: 'okx',
        symbol: t.instId.replace('-USDT-SWAP', 'USDT'),
        price: parseFloat(t.last),
        priceChange24h: ((parseFloat(t.last) - parseFloat(t.sodUtc8)) / parseFloat(t.sodUtc8)) * 100,
        volume24h: parseFloat(t.volCcy24h),
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
      }))
  } catch {
    return []
  }
}

export async function getMultiExchangeTickers(limit = 20): Promise<Map<string, ExchangeTicker[]>> {
  const [binance, bybit, okx] = await Promise.allSettled([
    getBinanceTickers(limit),
    getBybitTickers(limit),
    getOkxTickers(limit),
  ])

  const result = new Map<string, ExchangeTicker[]>()
  if (binance.status === 'fulfilled') result.set('binance', binance.value)
  if (bybit.status === 'fulfilled') result.set('bybit', bybit.value)
  if (okx.status === 'fulfilled') result.set('okx', okx.value)
  return result
}

export async function getCrossExchangeFundingRates(symbol = 'BTCUSDT'): Promise<ExchangeFundingRate[]> {
  const results: ExchangeFundingRate[] = []

  // Binance
  try {
    const data = await fetchJson<Array<{ symbol: string; fundingRate: string; fundingTime: number }>>(
      `${EXCHANGES.binance.funding}?symbol=${symbol}&limit=1`
    )
    if (data[0]) {
      results.push({
        exchange: 'binance',
        symbol: data[0].symbol,
        rate: parseFloat(data[0].fundingRate),
        nextTime: data[0].fundingTime,
      })
    }
  } catch { /* skip */ }

  // Bybit
  try {
    const data = await fetchJson<{ result: { list: Array<{ symbol: string; fundingRate: string; fundingRateTimestamp: number }> } }>(
      `${EXCHANGES.bybit.funding}&symbol=${symbol}&limit=1`
    )
    if (data.result.list[0]) {
      results.push({
        exchange: 'bybit',
        symbol: data.result.list[0].symbol,
        rate: parseFloat(data.result.list[0].fundingRate),
        nextTime: data.result.list[0].fundingRateTimestamp,
      })
    }
  } catch { /* skip */ }

  // OKX
  try {
    const data = await fetchJson<{ data: Array<{ instId: string; fundingRate: string; nextFundingTime: string }> }>(
      `${EXCHANGES.okx.funding}&instId=${symbol.replace('USDT', '-USDT-SWAP')}`
    )
    if (data.data[0]) {
      results.push({
        exchange: 'okx',
        symbol: symbol,
        rate: parseFloat(data.data[0].fundingRate),
        nextTime: parseInt(data.data[0].nextFundingTime),
      })
    }
  } catch { /* skip */ }

  return results
}
