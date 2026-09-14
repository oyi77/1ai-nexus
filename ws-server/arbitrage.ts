import { io } from './io'
import { latestPrices, latestDeriv } from './binance'

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
