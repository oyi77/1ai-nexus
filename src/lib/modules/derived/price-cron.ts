// ─────────────────────────────────────────────────────────────
// Price Snapshot Cron — Fetches prices every 60s and records them
// Runs as a background interval in the Next.js process
// ─────────────────────────────────────────────────────────────

import { registerAllModules } from '../index'
import { recordSnapshot } from './price-store'

const SNAPSHOT_INTERVAL = 60_000
const TRACKED_ASSETS = 'bitcoin,ethereum,solana,binancecoin,ripple,cardano,avalanche-2,dogecoin,polkadot,chainlink,uniswap,aave,lido-dao,maker,the-graph,arbitrum,optimism,matic-network'

const symbolMap: Record<string, string> = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB',
  ripple: 'XRP', cardano: 'ADA', 'avalanche-2': 'AVAX', dogecoin: 'DOGE',
  polkadot: 'DOT', chainlink: 'LINK', uniswap: 'UNI', aave: 'AAVE',
  'lido-dao': 'LDO', maker: 'MKR', 'the-graph': 'GRT', arbitrum: 'ARB',
  optimism: 'OP', 'matic-network': 'MATIC',
}

let timer: ReturnType<typeof setInterval> | undefined

export function startPriceSnapshotCron() {
  if (timer) return

  const tick = async () => {
    try {
      const registry = registerAllModules()
      const result = await registry.fetchOne('coingecko', {
        action: 'price',
        ids: TRACKED_ASSETS,
        vs_currency: 'usd',
      })

      const data = result.data as Record<string, { usd: number; usd_24h_change: number; usd_market_cap: number; usd_24h_vol: number }> | undefined
      if (!data) return

      const now = Date.now()
      for (const [coinId, info] of Object.entries(data)) {
        recordSnapshot({
          symbol: symbolMap[coinId] ?? coinId.toUpperCase(),
          price: info.usd,
          volume24h: info.usd_24h_vol ?? 0,
          marketCap: info.usd_market_cap ?? 0,
          change24h: info.usd_24h_change ?? 0,
          timestamp: now,
        })
      }
    } catch {
      // Silent — cron never crashes the app
    }
  }

  tick()
  timer = setInterval(tick, SNAPSHOT_INTERVAL)
}

export function stopPriceSnapshotCron() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}
