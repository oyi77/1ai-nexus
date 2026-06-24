import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { authMiddleware } from "./auth";
import WebSocket from "ws";
import { startSubscriber } from "./subscriber";

const PORT = parseInt(process.env.WS_PORT || "4401", 10);
const ALLOWED_ORIGINS = [
  'https://tracker.aitradepulse.com',
  'http://localhost:4400',
  'http://localhost:3000',
];

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
  pingInterval: 30000,
  pingTimeout: 10000,
  transports: ["websocket", "polling"],
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), streams: activeStreams });
});

// ─── Auth-protected namespaces ──────────────────────────────
const authNamespaces = ["/trades", "/alerts", "/flows", "/cex"];
for (const ns of authNamespaces) {
  const namespace = io.of(ns);
  namespace.use(authMiddleware);
  namespace.on("connection", (socket) => {
    console.log(`[WS] Client connected to ${ns}: ${socket.id}`);
    socket.on("join", (room: string) => { socket.join(room); });
    socket.on("leave", (room: string) => { socket.leave(room); });
    socket.on("disconnect", () => {});
  });
}

// ─── Public namespaces (no auth, browser-facing) ────────────

const DEPTH_SYMBOLS = ["btcusdt", "ethusdt", "solusdt", "xrpusdt", "dogeusdt", "avaxusdt", "linkusdt", "arbusdt", "opusdt"]
let activeStreams = 0

// ═══════════════════════════════════════════════════════════
// ORDERBOOK: Binance depth20@100ms → /orderbook namespace
// ═══════════════════════════════════════════════════════════
const orderbookNs = io.of("/orderbook")

function connectDepth(symbol: string) {
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth20@100ms`)
  activeStreams++
  ws.on("open", () => console.log(`[orderbook] ${symbol} connected`))
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      orderbookNs.to(symbol).emit("depth", { symbol, bids: msg.bids, asks: msg.asks, timestamp: Date.now() })
    } catch {}
  })
  ws.on("error", () => {})
  ws.on("close", () => { activeStreams--; setTimeout(() => connectDepth(symbol), 3000) })
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
const latestPrices = new Map<string, Record<string, unknown>>()

function connectTicker() {
  // Subscribe to all symbols via single combined stream
  const streams = DEPTH_SYMBOLS.map(s => `${s}@ticker`).join("/")
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
  activeStreams++
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
  ws.on("close", () => { activeStreams--; setTimeout(connectTicker, 3000) })
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
// FUTURES: Binance Futures ticker → /derivatives namespace
// Funding rate, OI, mark price, basis
// ═══════════════════════════════════════════════════════════
const derivativesNs = io.of("/derivatives")
const latestDeriv = new Map<string, Record<string, unknown>>()

function connectFuturesTicker() {
  const streams = DEPTH_SYMBOLS.map(s => `${s}@ticker`).join("/")
  const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`)
  activeStreams++
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
  ws.on("close", () => { activeStreams--; setTimeout(connectFuturesTicker, 3000) })
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

function connectLiquidations() {
  const streams = DEPTH_SYMBOLS.map(s => `${s}@forceOrder`).join("/")
  const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`)
  activeStreams++
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
  ws.on("close", () => { activeStreams--; setTimeout(connectLiquidations, 3000) })
}

liquidationsNs.on("connection", (socket) => {
  console.log(`[liquidations] Client: ${socket.id}`)
  socket.on("disconnect", () => {})
})


// ═══════════════════════════════════════════════════════════
// ARBITRAGE: Spot vs Futures spread + DEX vs CEX comparison
// Uses existing spot (latestPrices) + futures (latestDeriv) maps
// Computes spreads in real-time → /arbitrage namespace
// Also fetches DEX prices from GeckoTerminal every 15s
// ═══════════════════════════════════════════════════════════
const arbitrageNs = io.of("/arbitrage")

// DEX price cache
const dexPrices = new Map<string, { price: number; name: string; network: string; updatedAt: number }>()

async function fetchDexPrices() {
  for (const network of ['solana', 'eth', 'base']) {
    try {
      const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools?page=1`, {
        headers: { Accept: 'application/json' },
        signal: { timeout: 10000 } as unknown as AbortSignal,
      })
      if (!res.ok) continue
      const data = (await res.json()) as { data: Array<{ attributes: { name: string; address: string; base_token_price_usd: string; volume_usd: { h24: string } } }> }
      for (const pool of (data.data ?? [])) {
        const name = pool.attributes.name.split('/')[0].trim().toUpperCase()
        const price = parseFloat(pool.attributes.base_token_price_usd)
        const volume = parseFloat(pool.attributes.volume_usd?.h24 ?? '0')
        if (price > 0 && volume > 10000) {
          const existing = dexPrices.get(name)
          if (!existing || existing.updatedAt < Date.now() - 30000) {
            dexPrices.set(name, { price, name, network, updatedAt: Date.now() })
          }
        }
      }
    } catch {}
  }
}

// Fetch DEX prices on startup and every 15s
fetchDexPrices()
setInterval(fetchDexPrices, 15_000)

// Compute arbitrage opportunities on every price update
function computeArbitrage() {
  const opportunities: Array<{
    type: string
    symbol: string
    buyAt: string
    buyPrice: number
    sellAt: string
    sellPrice: number
    spread: number
    spreadPercent: number
    spreadBps: number
    volume24h: number
    signal: string
    timestamp: number
  }> = []

  // 1. Spot vs Futures spreads (Binance)
  for (const [symbol, spotData] of latestPrices) {
    const derivData = latestDeriv.get(symbol)
    if (!derivData) continue

    const spotPrice = (spotData as Record<string, number>).price
    const futuresPrice = (derivData as Record<string, number>).price
    if (!spotPrice || !futuresPrice) continue

    const spread = futuresPrice - spotPrice
    const spreadPercent = (spread / spotPrice) * 100
    const spreadBps = spreadPercent * 100

    if (Math.abs(spreadBps) > 1) {
      let signal = 'No Edge'
      if (spreadBps > 5) signal = 'Short Futures / Long Spot'
      else if (spreadBps < -5) signal = 'Long Futures / Short Spot'

      opportunities.push({
        type: 'CEX Spot-Futures',
        symbol: symbol.toUpperCase(),
        buyAt: spread > 0 ? 'Binance Spot' : 'Binance Futures',
        buyPrice: Math.min(spotPrice, futuresPrice),
        sellAt: spread > 0 ? 'Binance Futures' : 'Binance Spot',
        sellPrice: Math.max(spotPrice, futuresPrice),
        spread: Math.abs(spread),
        spreadPercent: Math.abs(spreadPercent),
        spreadBps: Math.abs(spreadBps),
        volume24h: (spotData as Record<string, number>).volume24h || 0,
        signal,
        timestamp: Date.now(),
      })
    }
  }

  // 2. DEX vs CEX price differences
  for (const [symbol, dexData] of dexPrices) {
    const cexData = latestPrices.get(symbol.toLowerCase())
    if (!cexData) continue

    const cexPrice = (cexData as Record<string, number>).price
    const dexPrice = dexData.price
    if (!cexPrice || !dexPrice) continue

    const diff = ((dexPrice - cexPrice) / cexPrice) * 100
    const diffBps = diff * 100

    if (Math.abs(diffBps) > 20) { // > 20 bps
      opportunities.push({
        type: 'DEX-CEX',
        symbol,
        buyAt: diff > 0 ? 'Binance' : dexData.network,
        buyPrice: Math.min(cexPrice, dexPrice),
        sellAt: diff > 0 ? dexData.network : 'Binance',
        sellPrice: Math.max(cexPrice, dexPrice),
        spread: Math.abs(dexPrice - cexPrice),
        spreadPercent: Math.abs(diff),
        spreadBps: Math.abs(diffBps),
        volume24h: 0,
        signal: diff > 0 ? 'Buy CEX / Sell DEX' : 'Buy DEX / Sell CEX',
        timestamp: Date.now(),
      })
    }
  }

  // 3. Funding rate arbitrage
  for (const [symbol, derivData] of latestDeriv) {
    const d = derivData as Record<string, unknown>
    const fundingRate = d.fundingRate as number
    if (!fundingRate) continue

    if (Math.abs(fundingRate) > 0.0003) {
      const annualized = fundingRate * 3 * 365 * 100
      opportunities.push({
        type: 'Funding Arb',
        symbol: symbol.toUpperCase(),
        buyAt: fundingRate > 0 ? 'Spot (neutral)' : 'Perp (earning)',
        buyPrice: d.price as number || 0,
        sellAt: fundingRate > 0 ? 'Perp (paying)' : 'Spot (neutral)',
        sellPrice: d.price as number || 0,
        spread: 0,
        spreadPercent: 0,
        spreadBps: 0,
        volume24h: d.volume24h as number || 0,
        signal: fundingRate > 0 ? `Short Perp (paying ${(fundingRate*100).toFixed(4)}%)` : `Long Perp (earning ${Math.abs(fundingRate*100).toFixed(4)}%)`,
        timestamp: Date.now(),
      })
    }
  }

  // Sort by spread
  opportunities.sort((a, b) => b.spreadBps - a.spreadBps)

  arbitrageNs.emit("arbitrage", {
    opportunities: opportunities.slice(0, 50),
    summary: {
      total: opportunities.length,
      cexFutures: opportunities.filter(o => o.type === 'CEX Spot-Futures').length,
      dexCex: opportunities.filter(o => o.type === 'DEX-CEX').length,
      funding: opportunities.filter(o => o.type === 'Funding Arb').length,
    },
    timestamp: Date.now(),
  })
}

// Recompute arbitrage every 2 seconds (using cached WS data)
setInterval(computeArbitrage, 2000)

arbitrageNs.on("connection", (socket) => {
  console.log(`[arbitrage] Client: ${socket.id}`)
  // Send initial snapshot
  computeArbitrage()
  socket.on("disconnect", () => {})
})

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
for (const sym of DEPTH_SYMBOLS) connectDepth(sym)
connectTicker()
connectFuturesTicker()
connectLiquidations()

const subscriber = startSubscriber(io);

httpServer.listen(PORT, () => {
  console.log(`[WS] Socket.io server on port ${PORT}`);
  console.log(`[WS] Streams: orderbook(${DEPTH_SYMBOLS.length}), prices, derivatives, liquidations, arbitrage`);
});

process.on("SIGTERM", async () => {
  console.log("[WS] Shutting down...");
  await subscriber.quit();
  io.close();
  httpServer.close();
  process.exit(0);
});
