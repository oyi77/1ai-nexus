import WebSocket from 'ws'
import { io } from './io'
import { alertRedis, incStreams, decStreams } from './shared'
import { scoreToken, tokenRegistry, ScoredToken } from './score'


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

// ═══════════════════════════════════════════════════════════════
// DEXSCREENER WS: Real-time token boost events (no auth needed)
// Provides enriched token metadata: price, liquidity, volume, FDV
// ═══════════════════════════════════════════════════════════════
interface DexScreenerBoost {
  tokenAddress: string
  chainId: string
  name?: string
  symbol?: string
  priceUsd?: string
  liquidity?: { usd?: number }
  fdv?: number
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number }
  url?: string
  totalBoost?: number
  mintAmount?: number
}



const TELEGRAM_HYPNOTIC_SCORE = 75 // score threshold for Telegram push alert

function scheduleTelegramAlert(token: ScoredToken) {
  if (token.score < TELEGRAM_HYPNOTIC_SCORE) return

  const alertPayload = {
    type: 'new_meme_token',
    token: {
      address: token.address,
      chain: token.chain,
      name: token.name,
      symbol: token.symbol,
      score: token.score,
      risk: token.risk,
      priceUsd: token.priceUsd,
      liquidity: token.liquidity,
      fdv: token.fdv,
      boosts: token.boosts,
      volume24h: token.volume24h,
      sources: token.sources,
    },
    message: `🚀 *${token.name} (${token.symbol})* hype score: ${token.score}/100\n💰 Price: $${formatCompact(token.priceUsd)}\n💧 Liq: $${formatCompact(token.liquidity)}\n📊 FDV: $${formatCompact(token.fdv)}\n🔥 Boosts: ${token.boosts}\n⚠️ Risk: ${token.risk}`,
    timestamp: new Date().toISOString(),
  }

  // Emit through Socket.IO alerts namespace
  io.of('/alerts').emit('event', alertPayload)

  // Publish to Redis for the Next.js Telegram bot to consume
  alertRedis.publish('nexus:memecoin-alerts', JSON.stringify(alertPayload)).catch(() => {})
}

function formatCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(2)
}

// === DEXSCREENER WS ===
let dexscreenerWs: WebSocket | null = null
let dexWsReconnectAttempts = 0

function connectDexScreenerWS() {
  const url = 'wss://ws-api.dexscreener.com'
  console.log('[dexscreener] connecting to ' + url)
  dexscreenerWs = new WebSocket(url)
  incStreams()

  dexscreenerWs.on('open', () => {
    console.log('[dexscreener] connected — subscribing to token-boosts')
    dexWsReconnectAttempts = 0
    dexscreenerWs!.send(JSON.stringify({
      type: 'subscribe',
      channel: 'token-boosts',
    }))
  })

  dexscreenerWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (!msg || !msg.pair) return

      const pair = msg.pair ?? msg
      const boost: DexScreenerBoost = {
        tokenAddress: pair.baseToken?.address ?? pair.tokenAddress ?? '',
        chainId: pair.chainId ?? pair.chain ?? 'solana',
        name: pair.baseToken?.name ?? pair.name ?? 'Unknown',
        symbol: pair.baseToken?.symbol ?? pair.symbol ?? '???',
        priceUsd: pair.priceUsd,
        liquidity: pair.liquidity,
        fdv: pair.fdv,
        volume: pair.volume,
        totalBoost: msg.totalBoost ?? pair.boostCount ?? 0,
      }

      if (!boost.tokenAddress) return

      const scored = scoreToken({
        address: boost.tokenAddress,
        chain: boost.chainId,
        name: boost.name ?? 'Unknown',
        symbol: boost.symbol ?? '???',
        priceUsd: parseFloat(boost.priceUsd ?? '0'),
        fdv: boost.fdv ?? 0,
        liquidity: boost.liquidity?.usd ?? 0,
        volume24h: boost.volume?.h24 ?? 0,
        boosts: boost.totalBoost ?? 0,
        sources: ['dexscreener'],
      })

      // Emit to dexscreener namespace (scanner listens here)
      dexscreenerNs.emit('boost', scored)

      // Also emit to memecoins namespace for unified view
      memecoinsNs.emit('token_update', scored)

      // Schedule Telegram alert if hype threshold crossed
      if (scored.score >= TELEGRAM_HYPNOTIC_SCORE) {
        scheduleTelegramAlert(scored)
      }
    } catch {}
  })

  dexscreenerWs.on('error', (err) => {
    console.error('[dexscreener] error:', (err as Error).message)
  })

  dexscreenerWs.on('close', () => {
    decStreams()
    dexscreenerWs = null
    const delay = Math.min(1000 * Math.pow(2, dexWsReconnectAttempts++), 30000)
    console.log(`[dexscreener] disconnected — reconnecting in ${delay}ms`)
    setTimeout(connectDexScreenerWS, delay)
  })
}

// ═══════════════════════════════════════════════════════════════
// DEXSCREENER SOCKET.IO NAMESPACE: Real-time token boosts for scanner
// ═══════════════════════════════════════════════════════════════
const dexscreenerNs = io.of('/dexscreener')
dexscreenerNs.on('connection', (socket) => {
  console.log('[dexscreener] Client: ' + socket.id)
  socket.on('subscribe:chain', (chain: string) => {
    socket.join('chain:' + chain)
  })
  socket.on('disconnect', () => {})
})


// Detect new token creation from raw Solana logs
function detectNewTokenCreation(logs: string[], program: string, _signature: string): { isNew: boolean; tokenMint?: string } {
  // Pump.fun: "Instruction: Create" creates a new token
  if (program === 'pumpfun') {
    const hasCreate = logs.some((l: string) =>
      l.includes('Instruction: Create') || l.includes('create') || l.includes('Create')
    )
    if (hasCreate) {
      // Try to extract the token mint address from logs
      const mintMatch = logs.join(' ').match(/mint:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/)
      return { isNew: true, tokenMint: mintMatch?.[1] }
    }
  }
  // Raydium CPMM: Pool creation on initialize2
  if (program === 'raydium-cpmm' || program === 'raydium-clmm') {
    const hasInitialize = logs.some((l: string) =>
      l.includes('initialize2') || l.includes('Initialize') || l.includes('createPool')
    )
    if (hasInitialize) {
      return { isNew: true }
    }
  }
  return { isNew: false }
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
  incStreams()

  ws.on('open', () => {
    console.log('[memecoins] Solana WS connected — subscribing to ' + Object.keys(SOL_PROGRAMS).length + ' DEX programs')
    for (const [_name, programId] of Object.entries(SOL_PROGRAMS)) {
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

        // === NEW TOKEN CREATION DETECTION ===
        const { isNew, tokenMint } = detectNewTokenCreation(logs, program, signature)

        if (isNew) {
          const scored = scoreToken({
            address: tokenMint ?? signature.slice(0, 44),
            chain: 'solana',
            name: tokenMint ?? `New@${signature.slice(0, 8)}`,
            symbol: 'NEW',
            sources: [program],
            boosts: 0,
            swapCount: 0,
          })
          memecoinsNs.emit('new_token', {
            type: 'new_token',
            signature,
            chain: 'solana',
            program,
            tokenMint: tokenMint ?? null,
            scored,
            logSnippet: logs.slice(0, 3).join(' | ').slice(0, 200),
            timestamp: Date.now(),
          })
          // Also emit to dexscreener namespace for unified scanner feed
          dexscreenerNs.emit('boost', scored)
          scheduleTelegramAlert(scored)
        }

        if (isSwap || program === 'pumpfun') {
          // Track swap count for scoring
          const tokenAddress = signature.slice(0, 44)
          const existing = tokenRegistry.get(tokenAddress)
          if (existing) {
            existing.swapCount = (existing.swapCount ?? 0) + 1
            const rescored = scoreToken(existing)
            memecoinsNs.emit('token_update', rescored)
          }

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
    decStreams()
    setTimeout(connectSolanaWS, 3000)
  })
}

// === EVM WS (Uniswap V2/V3 Swap events) ===
function connectEvmDex(name: string, config: { chain: string; rpc: string; routers: string[] }) {
  const ws = new WebSocket(config.rpc)
  incStreams()

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
    decStreams()
    setTimeout(() => connectEvmDex(name, config), 5000)
  })
}

// === START ALL DEX STREAMS ===
export function startAllDexStreams() {
  connectSolanaWS()
  connectDexScreenerWS()
  for (const [name, config] of Object.entries(EVM_ROUTERS)) {
    connectEvmDex(name, config)
  }
  console.log('[memecoins] All DEX streams started: Solana(11 programs) + EVM(4 chains) + DexScreener')
}

// Client connections
memecoinsNs.on('connection', (socket) => {
  console.log('[memecoins] Client: ' + socket.id)
  socket.on('disconnect', () => {})
})
