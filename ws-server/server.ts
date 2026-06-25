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

// DEX price cache — from GeckoTerminal (fast REST, 30s cache)
// Used only for tokens NOT on Binance (memecoins, new tokens)
const dexPrices = new Map<string, { price: number; name: string; network: string; pair: string; volume24h: number; liquidity: number; updatedAt: number }>()

// GeckoTerminal token addresses for memecoins not on Binance
const DEX_TOKENS: Record<string, { network: string; address: string }> = {
  'PEPE': { network: 'eth', address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933' },
  'WIF': { network: 'solana', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  'BONK': { network: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  'SHIB': { network: 'eth', address: '0x95aD61b0a150d79219dCF64E1D6c04dd4f6e0002' },
  'FLOKI': { network: 'eth', address: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e' },
}

async function fetchDexPrices() {
  for (const [symbol, info] of Object.entries(DEX_TOKENS)) {
    try {
      const res = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/${info.network}/token_price/${info.address}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const data = (await res.json()) as { data: { attributes: { token_prices: Record<string, string> } } }
      const price = parseFloat(data.data?.attributes?.token_prices?.[info.address] ?? '0')
      if (price > 0) {
        dexPrices.set(symbol, {
          price,
          name: symbol,
          network: info.network,
          pair: `${symbol}/USDT`,
          volume24h: 0,
          liquidity: 0,
          updatedAt: Date.now(),
        })
      }
    } catch {}
  }
  if (dexPrices.size > 0) {
    console.log(`[arbitrage] DEX prices updated: ${dexPrices.size} memecoins`)
  }
}

// Fetch DEX prices every 30s (only for non-Binance tokens)
fetchDexPrices()
setInterval(fetchDexPrices, 30_000)

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

  // 2. DEX vs CEX price differences (DexScreener vs Binance)
  for (const [symbol, dexData] of dexPrices) {
    const cexData = latestPrices.get(symbol.toLowerCase())
    if (!cexData) continue

    const cexPrice = (cexData as Record<string, number>).price
    const dexPrice = dexData.price
    if (!cexPrice || !dexPrice || cexPrice === 0) continue

    const diff = ((dexPrice - cexPrice) / cexPrice) * 100
    const diffBps = diff * 100

    if (Math.abs(diffBps) > 10) { // > 10 bps
      opportunities.push({
        type: 'DEX-CEX',
        symbol,
        buyAt: diff > 0 ? 'Binance CEX' : `${dexData.network} DEX (${dexData.pair})`,
        buyPrice: Math.min(cexPrice, dexPrice),
        sellAt: diff > 0 ? `${dexData.network} DEX (${dexData.pair})` : 'Binance CEX',
        sellPrice: Math.max(cexPrice, dexPrice),
        spread: Math.abs(dexPrice - cexPrice),
        spreadPercent: Math.abs(diff),
        spreadBps: Math.abs(diffBps),
        volume24h: dexData.volume24h,
        signal: diff > 0 ? 'Buy CEX → Sell DEX' : 'Buy DEX → Sell CEX',
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
// MEMECOIN: Solana Raydium + Pump.fun WS → /memecoins namespace
// Real-time swap events on Solana DEXes via public RPC
// ═══════════════════════════════════════════════════════════
// MULTI-CHAIN DEX MONITOR: Solana + Ethereum + BSC + Base
// Real-time swap events via public RPC WebSockets
// Zero API keys, zero cost
// ═══════════════════════════════════════════════════════════
const memecoinsNs = io.of("/memecoins")

// === SOLANA DEX PROGRAMS ===
const SOL_PROGRAMS: Record<string, string> = {
  // Raydium ecosystem
  'raydium-amm': '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'raydium-cpmm': 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  'raydium-clmm': 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  // Pump.fun
  'pumpfun': '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  // Meteora
  'meteora-dlmm': 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  'meteora-amm': 'Eo7WjKq67rjJQSZxS6z3YkapzY3eBj6xsLusPn6TYZro',
  // Orca
  'orca-whirlpool': 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  // Jupiter
  'jupiter': 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  // OpenBook
  'openbook': 'srmqPwymBn95sGJmkfDT25F3geVg593rr3EdB85e2gA',
  // Phoenix
  'phoenix': 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR8971M8LD42V',
  // Lifinity
  'lifinity': '2wT8Yq49kHgDzXuPxZSaeLb4Liti6UWsCNrFhk8o773a',
}

// === EVM DEX ROUTERS ===
const EVM_ROUTERS: Record<string, { chain: string; rpc: string; routers: string[] }> = {
  ethereum: {
    chain: 'eth',
    rpc: 'wss://ethereum-rpc.publicnode.com',
    routers: [
      '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2
      '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3
      '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // SushiSwap
    ],
  },
  base: {
    chain: 'base',
    rpc: 'wss://base-rpc.publicnode.com',
    routers: [
      '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43', // Aerodrome
      '0x327Df1E6de05895BFa8c4d48f81A3f1F10D9DeD7', // BaseSwap
    ],
  },
  bsc: {
    chain: 'bsc',
    rpc: 'wss://bsc-rpc.publicnode.com',
    routers: [
      '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap
    ],
  },
  arbitrum: {
    chain: 'arbitrum',
    rpc: 'wss://arbitrum-one-rpc.publicnode.com',
    routers: [
      '0x6ddF18B5168E1e3b4ECfC2Bf3baA192F4cdDA9DA', // Camelot
      '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
    ],
  },
}

// === SOLANA WS ===
function connectSolanaWS() {
  const ws = new WebSocket('wss://api.mainnet-beta.solana.com')
  activeStreams++

  ws.on('open', () => {
    console.log('[memecoins] Solana WS connected — subscribing to ' + Object.keys(SOL_PROGRAMS).length + ' DEX programs')
    for (const [name, programId] of Object.entries(SOL_PROGRAMS)) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 10000),
        method: 'logsSubscribe',
        params: [
          { mentions: [programId] },
          { commitment: 'confirmed' }
        ]
      }))
    }
  })

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.method === 'logsNotification') {
        const log = msg.params?.result
        if (!log) return
        
        const signature = log.signature as string
        const logs = (log.logs || []) as string[]
        const err = log.err
        
        // Detect program from logs
        let program = 'unknown'
        for (const [name, addr] of Object.entries(SOL_PROGRAMS)) {
          if (logs.some((l: string) => l.includes(addr))) {
            program = name
            break
          }
        }
        
        // Detect swap pattern
        const isSwap = logs.some((l: string) => 
          l.includes('ray_log') || 
          l.includes('Instruction: Swap') ||
          l.includes('Instruction: Buy') ||
          l.includes('Instruction: Sell') ||
          l.includes('Instruction: Create') ||
          l.includes('swap')
        )
        
        if (isSwap || program === 'pumpfun') {
          memecoinsNs.emit('memecoin', {
            type: isSwap ? 'swap' : 'activity',
            signature,
            chain: 'solana',
            program,
            success: !err,
            logSnippet: logs.slice(0, 3).join(' | ').slice(0, 200),
            timestamp: Date.now(),
          })
        }
      }
    } catch {}
  })

  ws.on('error', () => {})
  ws.on('close', () => {
    activeStreams--
    setTimeout(connectSolanaWS, 3000)
  })
}

// === EVM WS (Uniswap V2/V3 Swap events) ===
function connectEvmDex(name: string, config: { chain: string; rpc: string; routers: string[] }) {
  const ws = new WebSocket(config.rpc)
  activeStreams++

  // Uniswap V2 Swap event signature
  const UNISWAP_V2_SWAP = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
  // Uniswap V3 Swap event signature
  const UNISWAP_V3_SWAP = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64f8ee05b2b2c7d7c428'

  ws.on('open', () => {
    console.log(`[memecoins] ${name} EVM DEX WS connected`)
    // Subscribe to logs for all routers
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_subscribe',
      params: ['logs', {
        address: config.routers,
        topics: [[UNISWAP_V2_SWAP, UNISWAP_V3_SWAP]]
      }]
    }))
  })

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.method === 'eth_subscription' && msg.params?.result) {
        const log = msg.params.result
        const topic0 = log.topics?.[0]
        
        let type = 'swap'
        if (topic0 === UNISWAP_V2_SWAP) type = 'v2_swap'
        else if (topic0 === UNISWAP_V3_SWAP) type = 'v3_swap'

        memecoinsNs.emit('memecoin', {
          type,
          signature: log.transactionHash,
          chain: config.chain,
          contract: log.address,
          blockNumber: parseInt(log.blockNumber, 16),
          timestamp: Date.now(),
        })
      }
    } catch {}
  })

  ws.on('error', () => {})
  ws.on('close', () => {
    activeStreams--
    setTimeout(() => connectEvmDex(name, config), 5000)
  })
}

// === START ALL DEX STREAMS ===
function startAllDexStreams() {
  connectSolanaWS()
  for (const [name, config] of Object.entries(EVM_ROUTERS)) {
    connectEvmDex(name, config)
  }
  console.log('[memecoins] All DEX streams started: Solana(11 programs) + EVM(4 chains)')
}

// Client connections
memecoinsNs.on('connection', (socket) => {
  console.log('[memecoins] Client: ' + socket.id)
  socket.on('disconnect', () => {})
})
// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
for (const sym of DEPTH_SYMBOLS) connectDepth(sym)
connectTicker()
connectFuturesTicker()
connectLiquidations()
startAllDexStreams()

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
