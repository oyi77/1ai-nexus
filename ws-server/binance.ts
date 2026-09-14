import WebSocket from 'ws'
import { io } from './io'
import { DEPTH_SYMBOLS, incStreams, decStreams } from './shared'

// ═══════════════════════════════════════════════════════════
// ORDERBOOK: Binance depth20@100ms → /orderbook namespace
// ═══════════════════════════════════════════════════════════
const orderbookNs = io.of("/orderbook")

export function connectDepth(symbol: string) {
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth20@100ms`)
  incStreams()
  ws.on("open", () => console.log(`[orderbook] ${symbol} connected`))
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      orderbookNs.to(symbol).emit("depth", { symbol, bids: msg.bids, asks: msg.asks, timestamp: Date.now() })
    } catch {}
  })
  ws.on("error", () => {})
  ws.on("close", () => { decStreams(); setTimeout(() => connectDepth(symbol), 3000) })
}

orderbookNs.on("connection", (socket) => {
  console.log(`[orderbook] Client: ${socket.id}`)
  socket.on("subscribe", (symbol: string) => {
    const s = symbol.toLowerCase().replace("usdt", "") + "usdt"
    socket.join(s)
  })
  socket.on("unsubscribe", (symbol: string) => {
    socket.leave(symbol.toLowerCase().replace("usdt", "") + "usdt")
  })
  socket.on("disconnect", () => {})
})

// ═══════════════════════════════════════════════════════════
// TICKER: Binance 24h ticker → /prices namespace
// Real-time price, change, volume for all symbols
// ═══════════════════════════════════════════════════════════
const pricesNs = io.of("/prices")
export const latestPrices = new Map<string, Record<string, unknown>>()

export function connectTicker() {
  // Subscribe to all symbols via single combined stream
  const streams = DEPTH_SYMBOLS.map(s => `${s}@ticker`).join("/")
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
  incStreams()
  ws.on("open", () => console.log(`[prices] ticker stream connected (${DEPTH_SYMBOLS.length} symbols)`))
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const d = msg.data
      if (!d || !d.s) return
      const symbol = d.s.replace("USDT", "").toLowerCase()
      const priceData = {
        symbol,
        price: parseFloat(d.c),
        change24h: parseFloat(d.P),
        volume24h: parseFloat(d.q),
        high24h: parseFloat(d.h),
        low24h: parseFloat(d.l),
        trades24h: parseInt(d.n),
        timestamp: Date.now(),
      }
      latestPrices.set(symbol, priceData)
      pricesNs.emit("price", priceData)
    } catch {}
  })
  ws.on("error", () => {})
  ws.on("close", () => { decStreams(); setTimeout(connectTicker, 3000) })
}

pricesNs.on("connection", (socket) => {
  console.log(`[prices] Client: ${socket.id}`)
  // Send latest prices on connect
  for (const [, price] of latestPrices) {
    socket.emit("price", price)
  }
  socket.on("disconnect", () => {})
})

// ═══════════════════════════════════════════════════════════
// TRADE STREAM: Binance aggTrade → /trade-stream namespace
// Real-time individual trades for all symbols
// ═══════════════════════════════════════════════════════════
const tradeStreamNs = io.of("/trade-stream")

export function connectTradeStream() {
  const streams = DEPTH_SYMBOLS.map(s => `${s}@aggTrade`).join("/")
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
  incStreams()
  ws.on("open", () => console.log(`[trade-stream] aggTrade connected (${DEPTH_SYMBOLS.length} symbols)`))
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const d = msg.data
      if (!d || !d.T) return
      const trade = {
        exchange: 'Binance',
        pair: d.s.replace('USDT', ''),
        price: parseFloat(d.p),
        size: parseFloat(d.q),
        side: d.m ? 'sell' : 'buy',
        timestamp: d.T,
        usdValue: parseFloat(d.p) * parseFloat(d.q),
      }
      tradeStreamNs.emit("trade", trade)
    } catch {}
  })
  ws.on("error", () => {})
  ws.on("close", () => { decStreams(); setTimeout(connectTradeStream, 3000) })
}

tradeStreamNs.on("connection", (socket) => {
  console.log(`[trade-stream] Client: ${socket.id}`)
  socket.on("disconnect", () => {})
})


// ═══════════════════════════════════════════════════════════
// FUTURES: Binance Futures ticker → /derivatives namespace
// Funding rate, OI, mark price, basis
// ═══════════════════════════════════════════════════════════
const derivativesNs = io.of("/derivatives")
export const latestDeriv = new Map<string, Record<string, unknown>>()

export function connectFuturesTicker() {
  const streams = DEPTH_SYMBOLS.map(s => `${s}@ticker`).join("/")
  const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`)
  incStreams()
  ws.on("open", () => console.log(`[derivatives] futures ticker connected`))
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const d = msg.data
      if (!d || !d.s) return
      const symbol = d.s.replace("USDT", "").toLowerCase()
      const derivData = {
        symbol,
        price: parseFloat(d.c),
        markPrice: parseFloat(d.p ?? d.c),
        indexPrice: parseFloat(d.c),
        fundingRate: parseFloat(d.r ?? "0"),
        openInterest: parseFloat(d.o ?? "0"),
        change24h: parseFloat(d.P),
        volume24h: parseFloat(d.q),
        high24h: parseFloat(d.h),
        low24h: parseFloat(d.l),
        timestamp: Date.now(),
      }
      latestDeriv.set(symbol, derivData)
      derivativesNs.emit("deriv", derivData)
    } catch {}
  })
  ws.on("error", () => {})
  ws.on("close", () => { decStreams(); setTimeout(connectFuturesTicker, 3000) })
}

derivativesNs.on("connection", (socket) => {
  console.log(`[derivatives] Client: ${socket.id}`)
  for (const [, deriv] of latestDeriv) {
    socket.emit("deriv", deriv)
  }
  socket.on("disconnect", () => {})
})

// ═══════════════════════════════════════════════════════════
// LIQUIDATIONS: Binance Futures force orders → /liquidations
// ═══════════════════════════════════════════════════════════
const liquidationsNs = io.of("/liquidations")

export function connectLiquidations() {
  const streams = DEPTH_SYMBOLS.map(s => `${s}@forceOrder`).join("/")
  const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`)
  incStreams()
  ws.on("open", () => console.log(`[liquidations] force order stream connected`))
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const d = msg.data?.o
      if (!d) return
      const liq = {
        symbol: d.s,
        side: d.S === "BUY" ? "short" : "long", // forced buy = short liquidated
        price: parseFloat(d.p),
        quantity: parseFloat(d.q),
        usdValue: parseFloat(d.p) * parseFloat(d.q),
        timestamp: Date.now(),
      }
      liquidationsNs.emit("liquidation", liq)
    } catch {}
  })
  ws.on("error", () => {})
  ws.on("close", () => { decStreams(); setTimeout(connectLiquidations, 3000) })
}

liquidationsNs.on("connection", (socket) => {
  console.log(`[liquidations] Client: ${socket.id}`)
  socket.on("disconnect", () => {})
})
// ═══════════════════════════════════════════════════════════
// FOREX: Binance stablecoin pairs + Frankfurter.app (ECB rates)
// Real-time forex prices → /forex namespace
// ═══════════════════════════════════════════════════════════
const forexNs = io.of("/forex")
const latestForex = new Map<string, Record<string, unknown>>()

// Binance forex-like pairs (stablecoin crosses)
const FOREX_BINANCE = [
  "eurusdt", "gbpusdt", "audusdt", "usdcad", "usdchf",
  "nzdbusdt", "eurgbp", "euraud", "eurjpy", "gbpjpy",
]

function connectForexTicker() {
  const streams = FOREX_BINANCE.map(s => `${s}@ticker`).join("/")
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
  incStreams()
  ws.on("open", () => console.log(`[forex] Binance forex stream connected (${FOREX_BINANCE.length} pairs)`))
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const d = msg.data
      if (!d || !d.s) return
      const pair = d.s.toLowerCase()
      const priceData = {
        pair,
        price: parseFloat(d.c),
        change24h: parseFloat(d.P),
        high24h: parseFloat(d.h),
        low24h: parseFloat(d.l),
        volume24h: parseFloat(d.q),
        timestamp: Date.now(),
      }
      latestForex.set(pair, priceData)
      forexNs.emit("forex", priceData)
    } catch {}
  })
  ws.on("error", () => {})
  ws.on("close", () => { decStreams(); setTimeout(connectForexTicker, 3000) })
}

// Frankfurter.app (ECB rates) — REST fallback, refresh every 60s
const FRANKFURTER_PAIRS = ["USD", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "IDR", "SGD", "HKD"]

async function fetchFrankfurterRates() {
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${FRANKFURTER_PAIRS.join(",")}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return
    const data = await res.json() as { rates?: Record<string, number> }
    if (!data.rates) return
    const now = Date.now()
    for (const [currency, rate] of Object.entries(data.rates)) {
      const pair = `eur${currency.toLowerCase()}`
      const priceData = {
        pair,
        price: rate,
        change24h: 0, // ECB updates once daily
        high24h: rate,
        low24h: rate,
        volume24h: 0,
        timestamp: now,
        source: 'ecb',
      }
      latestForex.set(pair, priceData)
      forexNs.emit("forex", priceData)
    }
  } catch {}
}

forexNs.on("connection", (socket) => {
  console.log(`[forex] Client: ${socket.id}`)
  // Send latest prices on connect
  for (const [, price] of latestForex) {
    socket.emit("forex", price)
  }
  socket.on("disconnect", () => {})
})

// Start forex streams
connectForexTicker()
fetchFrankfurterRates()
setInterval(fetchFrankfurterRates, 60_000)
