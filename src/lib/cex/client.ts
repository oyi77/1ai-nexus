// CEX Exchange Client - Public API endpoints (no auth required)

interface CexTicker {
  symbol: string
  price: string
  volume: string
  priceChange: string
  priceChangePercent: string
}

interface CexFundingRate {
  symbol: string
  fundingRate: string
  fundingTime: number
}

interface CexLiquidation {
  symbol: string
  side: string
  quantity: string
  price: string
  time: number
}

const BINANCE_API = 'https://api.binance.com'
const BINANCE_FAPI = 'https://fapi.binance.com'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

const _cexClient = {
  async getExchangeStatus(): Promise<{ status: string }> {
    try {
      await fetchJson(`${BINANCE_API}/api/v3/ping`)
      return { status: 'online' }
    } catch (err) {
      console.error('[cex-client] Exchange status check failed:', err)
      return { status: 'offline' }
    }
  },

  async getPairs(limit = 100): Promise<CexTicker[]> {
    const tickers = await fetchJson<CexTicker[]>(`${BINANCE_API}/api/v3/ticker/24hr`)
    return tickers
      .filter(t => t.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
      .slice(0, limit)
  },

  async getTopPairs(limit = 20): Promise<CexTicker[]> {
    return this.getPairs(limit)
  },

  async getFundingRates(symbol = 'BTCUSDT'): Promise<CexFundingRate[]> {
    return fetchJson<CexFundingRate[]>(`${BINANCE_FAPI}/fapi/v1/fundingRate?symbol=${symbol}&limit=10`)
  },

  async getOpenInterest(symbol = 'BTCUSDT'): Promise<{ symbol: string; openInterest: string }> {
    return fetchJson<{ symbol: string; openInterest: string }>(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${symbol}`)
  },

  async getLiquidations(_symbol?: string): Promise<CexLiquidation[]> {
    // Binance doesn't have a public liquidations endpoint
    // Return empty array - liquidations would need websocket stream
    return []
  },

  async getExchangeInfo(): Promise<{ symbols: unknown[] }> {
    return fetchJson<{ symbols: unknown[] }>(`${BINANCE_API}/api/v3/exchangeInfo`)
  },
}
