// ─────────────────────────────────────────────────────────────
// Real-Time Order Book via Binance WebSocket
// Connects to wss://stream.binance.com:9443/ws for depth stream
// Zero API keys — free public endpoint
// ─────────────────────────────────────────────────────────────

interface OrderBookLevel {
  price: number
  quantity: number
  total: number
}

interface OrderBookSnapshot {
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  midPrice: number
  spread: number
  spreadBps: number
  bidDepth: number
  askDepth: number
  imbalance: number
  timestamp: number
}

const snapshots = new Map<string, OrderBookSnapshot>()
const connections = new Map<string, WebSocket>()

const SYMBOLS = ['btcusdt', 'ethusdt', 'solusdt', 'xrpusdt', 'dogeusdt', 'avaxusdt', 'linkusdt', 'arbusdt', 'opusdt']

function processDepthUpdate(symbol: string, bids: Array<[string, string]>, asks: Array<[string, string]>) {
  const bidLevels: OrderBookLevel[] = []
  const askLevels: OrderBookLevel[] = []
  let bidDepth = 0
  let askDepth = 0

  for (const [priceStr, qtyStr] of bids) {
    const price = parseFloat(priceStr)
    const quantity = parseFloat(qtyStr)
    if (quantity > 0) {
      const total = price * quantity
      bidLevels.push({ price, quantity, total })
      bidDepth += total
    }
  }

  for (const [priceStr, qtyStr] of asks) {
    const price = parseFloat(priceStr)
    const quantity = parseFloat(qtyStr)
    if (quantity > 0) {
      const total = price * quantity
      askLevels.push({ price, quantity, total })
      askDepth += total
    }
  }

  bidLevels.sort((a, b) => b.price - a.price)
  askLevels.sort((a, b) => a.price - b.price)

  const bestBid = bidLevels[0]?.price ?? 0
  const bestAsk = askLevels[0]?.price ?? 0
  const midPrice = (bestBid + bestAsk) / 2
  const spread = bestAsk - bestBid
  const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0
  const imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0

  snapshots.set(symbol, {
    bids: bidLevels.slice(0, 15),
    asks: askLevels.slice(0, 15),
    midPrice,
    spread,
    spreadBps,
    bidDepth,
    askDepth,
    imbalance,
    timestamp: Date.now(),
  })
}

function connectDepth(symbol: string) {
  if (connections.has(symbol)) return

  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth20@100ms`)
  connections.set(symbol, ws)

  ws.onopen = () => {
    console.log(`[orderbook-ws] ${symbol} connected`)
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string) as {
        bids: Array<[string, string]>
        asks: Array<[string, string]>
      }
      processDepthUpdate(symbol, data.bids, data.asks)
    } catch {
      // Silent parse errors
    }
  }

  ws.onerror = () => {
    console.warn(`[orderbook-ws] ${symbol} error`)
  }

  ws.onclose = () => {
    connections.delete(symbol)
    console.log(`[orderbook-ws] ${symbol} disconnected, reconnecting in 3s...`)
    setTimeout(() => connectDepth(symbol), 3000)
  }
}

/**
 * Start all orderbook WebSocket connections.
 * Call once on server startup.
 */
export function startOrderBookStreams() {
  for (const symbol of SYMBOLS) {
    connectDepth(symbol)
  }
}

/**
 * Get current orderbook snapshot for a symbol.
 */
export function getOrderBook(symbol: string): OrderBookSnapshot | null {
  return snapshots.get(symbol) ?? null
}

/**
 * Get all available symbols.
 */
export function getAvailableSymbols(): string[] {
  return [...snapshots.keys()]
}
