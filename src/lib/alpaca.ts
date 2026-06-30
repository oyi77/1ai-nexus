// ─── Alpaca Paper Trading Client ──────────────────────────
// Real broker integration for US stock paper trading.
// Free, no real money. Requires ALPACA_API_KEY + ALPACA_SECRET_KEY.
// ─────────────────────────────────────────────────────────

const ALPACA_BASE = process.env.ALPACA_DATA_URL ?? 'https://data.alpaca.markets'
const ALPACA_TRADING = process.env.ALPACA_TRADING_URL ?? 'https://paper-api.alpaca.markets'
const ALPACA_KEY = process.env.ALPACA_API_KEY ?? ''
const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY ?? ''

export interface AlpacaPosition {
  symbol: string
  qty: string
  avgEntryPrice: string
  currentPrice: string
  marketValue: string
  unrealizedPnl: string
  unrealizedPnlPct: string
  side: 'long' | 'short'
}

export interface AlpacaOrder {
  id: string
  symbol: string
  qty: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop'
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok'
  limit_price: string | null
  stop_price: string | null
  status: 'new' | 'partially_filled' | 'filled' | 'done_for_day' | 'canceled' | 'expired' | 'replaced' | 'pending_cancel' | 'pending_replace' | 'accepted' | 'pending_new' | 'accepted_for_bidding' | 'stopped' | 'rejected' | 'suspended' | 'calculated'
  filled_avg_price: string | null
  filled_qty: string
  submitted_at: string
  filled_at: string | null
}

export interface AlpacaAccount {
  id: string
  status: string
  currency: string
  cash: string
  portfolio_value: string
  buying_power: string
  equity: string
  last_equity: string
  long_market_value: string
  short_market_value: string
  initial_margin: string
  maintenance_margin: string
}

function headers(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': ALPACA_KEY,
    'APCA-API-SECRET-KEY': ALPACA_SECRET,
    'Accept': 'application/json',
  }
}

function isConfigured(): boolean {
  return ALPACA_KEY.length > 0 && ALPACA_SECRET.length > 0
}

async function alpacaFetch<T>(url: string, options?: RequestInit): Promise<T> {
  if (!isConfigured()) throw new Error('Alpaca API not configured. Set ALPACA_API_KEY and ALPACA_SECRET_KEY.')
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(), ...options?.headers },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Alpaca ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

// ─── Account ──────────────────────────────────────────────

export async function getAccount(): Promise<AlpacaAccount> {
  return alpacaFetch<AlpacaAccount>(`${ALPACA_TRADING}/v2/account`)
}

// ─── Positions ────────────────────────────────────────────

export async function getPositions(): Promise<AlpacaPosition[]> {
  return alpacaFetch<AlpacaPosition[]>(`${ALPACA_TRADING}/v2/positions`)
}

export async function getPosition(symbol: string): Promise<AlpacaPosition> {
  return alpacaFetch<AlpacaPosition>(`${ALPACA_TRADING}/v2/positions/${symbol}`)
}

// ─── Orders ───────────────────────────────────────────────

export async function getOrders(status?: string, limit = 50): Promise<AlpacaOrder[]> {
  const params = new URLSearchParams({ limit: limit.toString() })
  if (status) params.set('status', status)
  return alpacaFetch<AlpacaOrder[]>(`${ALPACA_TRADING}/v2/orders?${params}`)
}

export async function placeOrder(params: {
  symbol: string
  qty: number
  side: 'buy' | 'sell'
  type: 'market' | 'limit' | 'stop' | 'stop_limit'
  time_in_force?: 'day' | 'gtc'
  limit_price?: number
  stop_price?: number
}): Promise<AlpacaOrder> {
  return alpacaFetch<AlpacaOrder>(`${ALPACA_TRADING}/v2/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force ?? 'day',
      limit_price: params.limit_price?.toString(),
      stop_price: params.stop_price?.toString(),
    }),
  })
}

export async function cancelOrder(orderId: string): Promise<void> {
  await alpacaFetch(`${ALPACA_TRADING}/v2/orders/${orderId}`, { method: 'DELETE' })
}

export async function cancelAllOrders(): Promise<void> {
  await alpacaFetch(`${ALPACA_TRADING}/v2/orders`, { method: 'DELETE' })
}

// ─── Market Data ──────────────────────────────────────────

export interface AlpacaQuote {
  symbol: string
  bidPrice: number
  askPrice: number
  bidSize: number
  askSize: number
  timestamp: string
}

export interface AlpacaBar {
  t: string // timestamp
  o: number // open
  h: number // high
  l: number // low
  c: number // close
  v: number // volume
}

export async function getLatestQuote(symbol: string): Promise<AlpacaQuote> {
  const data = await alpacaFetch<{ quote: { bp: number; ap: number; bs: number; as: number; t: string } }>(
    `${ALPACA_BASE}/v2/stocks/${symbol}/quotes/latest`
  )
  return {
    symbol,
    bidPrice: data.quote.bp,
    askPrice: data.quote.ap,
    bidSize: data.quote.bs,
    askSize: data.quote.as,
    timestamp: data.quote.t,
  }
}

export async function getBars(symbol: string, timeframe = '1Day', limit = 100): Promise<AlpacaBar[]> {
  const params = new URLSearchParams({ timeframe, limit: limit.toString() })
  const data = await alpacaFetch<{ bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> }>(
    `${ALPACA_BASE}/v2/stocks/${symbol}/bars?${params}`
  )
  return (data.bars ?? []).map(bar => ({
    t: bar.t,
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.v,
  }))
}

// ─── Status ───────────────────────────────────────────────

export function getAlpacaStatus(): { configured: boolean; mode: string } {
  return {
    configured: isConfigured(),
    mode: 'paper', // Always paper trading for safety
  }
}
