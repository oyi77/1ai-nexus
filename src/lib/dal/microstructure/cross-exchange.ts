// ─────────────────────────────────────────────────────────────
// Cross-Exchange Basis Tracker — spot price divergence
// Tier 0: Binance, OKX, Bybit free public APIs
// §4.2 — same asset, different venue → spread = opportunity
// ─────────────────────────────────────────────────────────────

export interface ExchangeSpotPrice {
  exchange: string
  symbol: string
  price: number
}

export interface BasisSpread {
  symbol: string
  venueA: string
  venueB: string
  priceA: number
  priceB: number
  spreadPct: number
  zScore: number
  alert: boolean
  timestamp: number
}

interface BasisHistoryPoint {
  spreadPct: number
  timestamp: number
}

const EXCHANGE_APIS: Record<string, (symbol: string) => string> = {
  binance: (s: string) => `https://api.binance.com/api/v3/ticker/price?symbol=${s}`,
  okx: (s: string) => `https://www.okx.com/api/v5/market/ticker?instId=${s.replace('USDT', '-USDT')}`,
  bybit: (s: string) => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}`,
}

// 30-day rolling window keyed by "SYMBOL:VENUEA:VENUEB"
const BASIS_HISTORY: Map<string, BasisHistoryPoint[]> = new Map()
const MAX_HISTORY_DAYS = 30
const MAX_POINTS = MAX_HISTORY_DAYS * 24 * 4
const ALERT_THRESHOLD_ZSCORE = 2

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT']

function historyKey(symbol: string, venueA: string, venueB: string): string {
  return `${symbol}:${venueA}:${venueB}`
}

function pushBasisHistory(key: string, spreadPct: number, timestamp: number) {
  if (!BASIS_HISTORY.has(key)) BASIS_HISTORY.set(key, [])
  const arr = BASIS_HISTORY.get(key)!
  arr.push({ spreadPct, timestamp })
  const cutoff = timestamp - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000
  while (arr.length > 0 && arr[0].timestamp < cutoff) arr.shift()
  if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS)
}

function calcZScore(history: BasisHistoryPoint[], current: number): number {
  if (history.length < 2) return 0
  const values = history.map(p => p.spreadPct)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const stdDev = Math.sqrt(variance)
  if (stdDev < 0.0001) return 0
  return (current - mean) / stdDev
}

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

// Normalize OKX symbol format: BTC-USDT → BTCUSDT
function normalizeOkxSymbol(instId: string): string {
  return instId.replace('-', '')
}

async function fetchBinancePrice(symbol: string): Promise<ExchangeSpotPrice | null> {
  try {
    const data = await fetchJson<{ symbol: string; price: string }>(EXCHANGE_APIS.binance(symbol))
    return { exchange: 'binance', symbol, price: Number(data.price) }
  } catch { return null }
}

async function fetchOkxPrice(symbol: string): Promise<ExchangeSpotPrice | null> {
  try {
    const data = await fetchJson<{ data: Array<{ instId: string; last: string }> }>(EXCHANGE_APIS.okx(symbol))
    const ticker = data.data?.[0]
    if (!ticker) return null
    return { exchange: 'okx', symbol: normalizeOkxSymbol(ticker.instId), price: Number(ticker.last) }
  } catch { return null }
}

async function fetchBybitPrice(symbol: string): Promise<ExchangeSpotPrice | null> {
  try {
    const data = await fetchJson<{ result: { list: Array<{ symbol: string; lastPrice: string }> } }>(EXCHANGE_APIS.bybit(symbol))
    const ticker = data.result?.list?.[0]
    if (!ticker) return null
    return { exchange: 'bybit', symbol: ticker.symbol, price: Number(ticker.lastPrice) }
  } catch { return null }
}

/**
 * Fetch same-asset spot price from all three exchanges simultaneously.
 */
async function fetchAllPrices(symbol: string): Promise<ExchangeSpotPrice[]> {
  const results = await Promise.allSettled([
    fetchBinancePrice(symbol),
    fetchOkxPrice(symbol),
    fetchBybitPrice(symbol),
  ])
  return results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((p): p is ExchangeSpotPrice => p !== null && p.price > 0)
}

function computePairwiseBasis(prices: ExchangeSpotPrice[], symbol: string, now: number): BasisSpread[] {
  const spreads: BasisSpread[] = []

  for (let i = 0; i < prices.length; i++) {
    for (let j = i + 1; j < prices.length; j++) {
      const a = prices[i]
      const b = prices[j]
      const spreadPct = b.price > 0
        ? ((a.price - b.price) / b.price) * 100
        : 0

      const key = historyKey(symbol, a.exchange, b.exchange)
      pushBasisHistory(key, spreadPct, now)
      const history = BASIS_HISTORY.get(key) || []
      const zScore = calcZScore(history, spreadPct)

      spreads.push({
        symbol,
        venueA: a.exchange,
        venueB: b.exchange,
        priceA: a.price,
        priceB: b.price,
        spreadPct,
        zScore,
        alert: Math.abs(zScore) > ALERT_THRESHOLD_ZSCORE,
        timestamp: now,
      })
    }
  }

  return spreads
}

/**
 * Get cross-exchange basis spreads for a symbol.
 */
export async function getCrossExchangeBasis(symbol = 'BTCUSDT'): Promise<BasisSpread[]> {
  const prices = await fetchAllPrices(symbol)
  if (prices.length < 2) return []
  return computePairwiseBasis(prices, symbol, Date.now())
}

/**
 * Get cross-exchange basis for all tracked symbols.
 */
export async function getAllBases(): Promise<BasisSpread[]> {
  const now = Date.now()
  const allResults = await Promise.allSettled(
    DEFAULT_SYMBOLS.map(async symbol => {
      const prices = await fetchAllPrices(symbol)
      if (prices.length < 2) return [] as BasisSpread[]
      return computePairwiseBasis(prices, symbol, now)
    }),
  )

  return allResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])
}
