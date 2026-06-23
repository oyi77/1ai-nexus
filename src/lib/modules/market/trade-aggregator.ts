// ─────────────────────────────────────────────────────────────
// Real-Time Trade Aggregator
// Inspired by aggr.trade — connects to multiple exchange WebSockets
// Aggregates live trades for volume/flow analysis
// Zero API keys — all public WS endpoints
// ─────────────────────────────────────────────────────────────

export interface Trade {
  exchange: string
  pair: string
  price: number
  size: number
  side: 'buy' | 'sell'
  timestamp: number
  usdValue: number
}

export interface AggregatedFlow {
  symbol: string
  buyVolume: number
  sellVolume: number
  netFlow: number
  tradeCount: number
  vwap: number
  lastPrice: number
  lastUpdate: number
}

// ── Pair format helpers ────────────────────────────────────────
/** "btcusdt" → "XXBTZUSD" for Kraken WS v2 */
const KRAKEN_PAIR_MAP: Record<string, string> = {
  btcusdt: 'XXBTZUSD',
  ethusdt: 'XETHZUSD',
  solusdt: 'SOLUSD',
  xrpusdt: 'XXRPZUSD',
  dogeusdt: 'DOGEUSD',
}

/** "XXBTZUSD" → "btcusdt" — reverse map for normalizing Kraken symbols in trade messages */
const KRAKEN_SYMBOL_TO_PAIR: Record<string, string> = Object.fromEntries(
  Object.entries(KRAKEN_PAIR_MAP).map(([k, v]) => [v, k])
)

function pairToKraken(pair: string): string {
  return KRAKEN_PAIR_MAP[pair.toLowerCase()] ?? pair.replace('usdt', '').toUpperCase() + '/USD'
}

/** "btcusdt" → "BTC_USDT" for Gate.io */
function pairToGate(pair: string): string {
  const base = pair.replace('usdt', '').toUpperCase()
  return `${base}_USDT`
}

interface ExchangeConfig {
  url: string
  subscribe: (pair: string) => string
  parse: (data: unknown) => Trade[]
  /** Optional pre-parse hook for exchanges needing side-effects (e.g. Bitfinex channel tracking) */
  onRawMessage?: (data: unknown, ws: WebSocket) => void
}

// Exchange WS configurations (from aggr.trade open-source + verified API docs)
const EXCHANGE_WS: Record<string, ExchangeConfig> = {
  binance: {
    url: 'wss://data-stream.binance.vision:9443/ws',
    subscribe: (pair: string) => JSON.stringify({
      method: 'SUBSCRIBE',
      params: [`${pair.toLowerCase()}@trade`],
      id: 1,
    }),
    parse: (data: unknown): Trade[] => {
      const msg = data as { e?: string; s?: string; p?: string; q?: string; T?: number; m?: boolean }
      if (msg.e !== 'trade' || !msg.s) return []
      const price = parseFloat(msg.p ?? '0')
      const size = parseFloat(msg.q ?? '0')
      return [{
        exchange: 'binance',
        pair: msg.s.toLowerCase(),
        price,
        size,
        side: msg.m ? 'sell' : 'buy',
        timestamp: msg.T ?? Date.now(),
        usdValue: price * size,
      }]
    },
  },
  binance_futures: {
    url: 'wss://fstream.binance.com/ws',
    subscribe: (pair: string) => JSON.stringify({
      method: 'SUBSCRIBE',
      params: [`${pair.toLowerCase()}@trade`],
      id: 1,
    }),
    parse: (data: unknown): Trade[] => {
      const msg = data as { e?: string; s?: string; p?: string; q?: string; T?: number; m?: boolean }
      if (msg.e !== 'trade' || !msg.s) return []
      const price = parseFloat(msg.p ?? '0')
      const size = parseFloat(msg.q ?? '0')
      return [{
        exchange: 'binance_futures',
        pair: msg.s.toLowerCase(),
        price,
        size,
        side: msg.m ? 'sell' : 'buy',
        timestamp: msg.T ?? Date.now(),
        usdValue: price * size,
      }]
    },
  },
  okx: {
    url: 'wss://ws.okx.com:8443/ws/v5/public',
    subscribe: (pair: string) => JSON.stringify({
      op: 'subscribe',
      args: [{ channel: 'trades', instId: pair.toUpperCase() }],
    }),
    parse: (data: unknown): Trade[] => {
      const msg = data as { data?: Array<{ instId?: string; px?: string; sz?: string; ts?: string; side?: string }> }
      if (!msg.data) return []
      return msg.data.map(t => {
        const price = parseFloat(t.px ?? '0')
        const size = parseFloat(t.sz ?? '0')
        return {
          exchange: 'okx',
          pair: (t.instId ?? '').toLowerCase(),
          price,
          size,
          side: t.side === 'buy' ? 'buy' : 'sell',
          timestamp: parseInt(t.ts ?? '0') || Date.now(),
          usdValue: price * size,
        }
      })
    },
  },
  // ── New exchanges ─────────────────────────────────────────────
  bybit: {
    url: 'wss://stream.bybit.com/v5/public/spot',
    subscribe: (pair: string) => JSON.stringify({
      op: 'subscribe',
      args: [`publicTrade.${pair.toUpperCase()}`],
    }),
    parse: (data: unknown): Trade[] => {
      const msg = data as { topic?: string; data?: Array<{ s?: string; S?: string; v?: string; p?: string; T?: number }> }
      if (!msg.data) return []
      return msg.data.map(t => {
        const price = parseFloat(t.p ?? '0')
        const size = parseFloat(t.v ?? '0')
        return {
          exchange: 'bybit',
          pair: (t.s ?? '').toLowerCase(),
          price,
          size,
          side: t.S === 'Buy' ? 'buy' : 'sell',
          timestamp: t.T ?? Date.now(),
          usdValue: price * size,
        }
      })
    },
  },
  bybit_futures: {
    url: 'wss://stream.bybit.com/v5/public/linear',
    subscribe: (pair: string) => JSON.stringify({
      op: 'subscribe',
      args: [`publicTrade.${pair.toUpperCase()}`],
    }),
    parse: (data: unknown): Trade[] => {
      const msg = data as { topic?: string; data?: Array<{ s?: string; S?: string; v?: string; p?: string; T?: number }> }
      if (!msg.data) return []
      return msg.data.map(t => {
        const price = parseFloat(t.p ?? '0')
        const size = parseFloat(t.v ?? '0')
        return {
          exchange: 'bybit_futures',
          pair: (t.s ?? '').toLowerCase(),
          price,
          size,
          side: t.S === 'Buy' ? 'buy' : 'sell',
          timestamp: t.T ?? Date.now(),
          usdValue: price * size,
        }
      })
    },
  },
  bitfinex: {
    url: 'wss://api-pub.bitfinex.com/ws/2',
    subscribe: (pair: string) => JSON.stringify({
      event: 'subscribe',
      channel: 'trades',
      symbol: `t${pair.toUpperCase()}`,
    }),
    onRawMessage: (data: unknown, _ws: WebSocket) => {
      if (typeof data !== 'object' || data === null) return

      // Track channel → symbol from subscription confirmation
      if ('event' in data) {
        const evt = data as { event?: string; chanId?: number; symbol?: string }
        if (evt.event === 'subscribed' && evt.chanId !== undefined && evt.symbol) {
          // tBTCUSDT → btcusdt
          bitfinexChannelMap[evt.chanId] = evt.symbol.replace(/^t/, '').toLowerCase()
        }
        return
      }

      // Track channel from initial snapshot: [CHAN_ID, [trades...]]
      if (Array.isArray(data) && data.length >= 2 && typeof data[0] === 'number') {
        const channelId = data[0] as number
        if (Array.isArray(data[1]) && bitfinexChannelMap[channelId] === undefined) {
          // Snapshot arrived before sub confirmation — will be resolved by next sub event
          bitfinexChannelMap[channelId] = ''
        }
      }
    },
    parse: (data: unknown): Trade[] => {
      if (!Array.isArray(data) || data.length < 2) return []
      const channelId = data[0] as number

      // Snapshot: [CHAN_ID, [trade, trade, ...]]
      if (Array.isArray(data[1])) return []

      // Trade execution: [CHAN_ID, "te", [id, timestamp, amount, price]]
      if (data[1] === 'te' && data.length >= 3 && Array.isArray(data[2])) {
        const trade = data[2] as unknown[]
        const price = Number(trade[3] ?? 0)
        const amount = Number(trade[2] ?? 0)
        const ts = Number(trade[1] ?? Date.now())
        const pair = bitfinexChannelMap[channelId] ?? 'btcusdt'
        return [{
          exchange: 'bitfinex',
          pair,
          price,
          size: Math.abs(amount),
          side: amount < 0 ? 'sell' : 'buy',
          timestamp: ts > 1e12 ? ts : ts * 1000,
          usdValue: price * Math.abs(amount),
        }]
      }
      return []
    },
  },
  kraken: {
    url: 'wss://ws.kraken.com/v2',
    subscribe: (pair: string) => JSON.stringify({
      method: 'subscribe',
      params: {
        channel: 'trade',
        symbol: [pairToKraken(pair)],
      },
    }),
    parse: (data: unknown): Trade[] => {
      const msg = data as {
        channel?: string
        type?: string
        data?: Array<{
          symbol?: string
          side?: string
          price?: number
          qty?: number
          timestamp?: string
          trade_id?: number
        }>
      }
      if (msg.channel !== 'trade' || msg.type !== 'update' || !msg.data) return []
      return msg.data.map(t => {
        const price = t.price ?? 0
        const size = t.qty ?? 0
        const ts = t.timestamp ? new Date(t.timestamp).getTime() : Date.now()
        // Kraken uses "XXBTZUSD" → normalize to "xxbtusdt" so updateFlow strips "usdt" → "XXBT"
        const krakenSym = (t.symbol ?? '').toUpperCase()
        const symbol = (KRAKEN_SYMBOL_TO_PAIR[krakenSym] ?? (krakenSym.toLowerCase() + 't')).toLowerCase()
        return {
          exchange: 'kraken',
          pair: symbol,
          price,
          size,
          side: t.side === 'buy' ? 'buy' : 'sell',
          timestamp: ts,
          usdValue: price * size,
        }
      })
    },
  },
  gateio: {
    url: 'wss://api.gateio.ws/ws/v4/',
    subscribe: (pair: string) => JSON.stringify({
      time: Math.floor(Date.now() / 1000),
      channel: 'spot.trades',
      event: 'subscribe',
      payload: [pairToGate(pair)],
    }),
    parse: (data: unknown): Trade[] => {
      const msg = data as {
        channel?: string
        event?: string
        result?: Array<{
          id?: number
          create_time?: number
          create_time_ms?: string
          side?: string
          price?: string
          amount?: string
          currency_pair?: string
        }>
      }
      if (msg.channel !== 'spot.trades' || msg.event !== 'update' || !msg.result) return []
      return msg.result.map(t => {
        const price = parseFloat(t.price ?? '0')
        const size = parseFloat(t.amount ?? '0')
        const ts = t.create_time_ms
          ? parseInt(t.create_time_ms)
          : (t.create_time ?? Math.floor(Date.now() / 1000)) * 1000
        return {
          exchange: 'gateio',
          pair: (t.currency_pair ?? '').toLowerCase().replace('_', ''),
          price,
          size,
          side: t.side === 'sell' ? 'sell' : 'buy',
          timestamp: ts,
          usdValue: price * size,
        }
      })
    },
  },
}

// Bitfinex WS v2 channel → symbol mapping (populated on subscribe)
const bitfinexChannelMap: Record<number, string> = {}

const SUPPORTED_PAIRS = ['btcusdt', 'ethusdt', 'solusdt', 'xrpusdt', 'dogeusdt']

// In-memory flow aggregation
const flowMap = new Map<string, AggregatedFlow>()
const MAX_TRADES = 10000
const recentTrades: Trade[] = []
let totalBuyVolume = 0
let totalSellVolume = 0
let connected = false

function updateFlow(trade: Trade) {
  const key = trade.pair.replace('usdt', '').toUpperCase()
  const existing = flowMap.get(key) ?? {
    symbol: key,
    buyVolume: 0,
    sellVolume: 0,
    netFlow: 0,
    tradeCount: 0,
    vwap: 0,
    lastPrice: 0,
    lastUpdate: 0,
  }

  if (trade.side === 'buy') {
    existing.buyVolume += trade.usdValue
    totalBuyVolume += trade.usdValue
  } else {
    existing.sellVolume += trade.usdValue
    totalSellVolume += trade.usdValue
  }

  existing.netFlow = existing.buyVolume - existing.sellVolume
  existing.tradeCount++
  existing.lastPrice = trade.price
  existing.lastUpdate = trade.timestamp

  // VWAP
  const totalVol = existing.buyVolume + existing.sellVolume
  existing.vwap = totalVol > 0 ? (existing.buyVolume * trade.price + existing.sellVolume * trade.price) / totalVol : trade.price

  flowMap.set(key, existing)

  // Keep recent trades
  recentTrades.unshift(trade)
  if (recentTrades.length > MAX_TRADES) recentTrades.length = MAX_TRADES
}

/**
 * Connect to a single exchange. Reconnects individually on disconnect.
 */
function connectExchange(exchangeId: string, config: ExchangeConfig) {
  try {
    const ws = new WebSocket(config.url)

    ws.onopen = () => {
      console.log(`[trade-aggregator] ${exchangeId} connected`)
      for (const pair of SUPPORTED_PAIRS) {
        ws.send(config.subscribe(pair))
      }
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        // Pre-parse hook (e.g. Bitfinex channel tracking)
        if (config.onRawMessage) config.onRawMessage(data, ws)
        const trades = config.parse(data)
        for (const trade of trades) {
          if (trade.usdValue > 0) updateFlow(trade)
        }
      } catch {
        // Silent parse errors
      }
    }

    ws.onerror = () => {
      console.warn(`[trade-aggregator] ${exchangeId} error`)
    }

    ws.onclose = () => {
      console.log(`[trade-aggregator] ${exchangeId} disconnected, reconnecting in 5s...`)
      setTimeout(() => connectExchange(exchangeId, config), 5000)
    }
  } catch (err) {
    console.error(`[trade-aggregator] Failed to connect ${exchangeId}:`, (err as Error).message)
  }
}

/**
 * Start WebSocket connections to exchanges.
 * Call once on server startup. Trades accumulate in memory.
 */
export function startTradeAggregator() {
  if (connected) return
  connected = true

  for (const [exchangeId, config] of Object.entries(EXCHANGE_WS)) {
    connectExchange(exchangeId, config)
  }
}

/**
 * Get current flow data for all tracked symbols.
 */
export function getFlowData(): {
  flows: AggregatedFlow[]
  totalBuyVolume: number
  totalSellVolume: number
  totalNetFlow: number
  tradeCount: number
  connected: boolean
} {
  return {
    flows: [...flowMap.values()].sort((a, b) => (b.buyVolume + b.sellVolume) - (a.buyVolume + a.sellVolume)),
    totalBuyVolume,
    totalSellVolume,
    totalNetFlow: totalBuyVolume - totalSellVolume,
    tradeCount: recentTrades.length,
    connected,
  }
}

/**
 * Get recent trades (newest first).
 */
export function getRecentTrades(limit = 50): Trade[] {
  return recentTrades.slice(0, limit)
}

/**
 * Reset all flow data (for testing).
 */
export function resetFlowData() {
  flowMap.clear()
  recentTrades.length = 0
  totalBuyVolume = 0
  totalSellVolume = 0
}