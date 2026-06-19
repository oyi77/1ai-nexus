// ─────────────────────────────────────────────────────────────
// Price Snapshot Cron — Fetches prices every 60s and records them
// Runs as a background interval in the Next.js process
// ─────────────────────────────────────────────────────────────

import { registerAllModules } from '../index'
import { recordSnapshot } from './price-store'

const SNAPSHOT_INTERVAL = 60_000
const TRACKED_ASSETS = 'bitcoin,ethereum,solana,binancecoin,ripple,cardano,avalanche-2,dogecoin,polkadot,chainlink,uniswap,aave,lido-dao,maker,the-graph,arbitrum,optimism,matic-network,aptos,sui,celestia,injective-protocol,sei-network,jupiter-exchange,jito-governance-magnet,raydium,marinade,pendle,eigenlayer,ethena,ondo-finance,maplefinance,sky-mavis,render-token,fet-ai,akash-network,bittensor,singularitynet,worldcoin,wormhole,layerzero,stargate-finance,synthetix,gmx,dydx,curve-dao-token,compound-governance-token,yearn-finance,sushiswap,1inch'

const symbolMap: Record<string, string> = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB',
  ripple: 'XRP', cardano: 'ADA', 'avalanche-2': 'AVAX', dogecoin: 'DOGE',
  polkadot: 'DOT', chainlink: 'LINK', uniswap: 'UNI', aave: 'AAVE',
  'lido-dao': 'LDO', maker: 'MKR', 'the-graph': 'GRT', arbitrum: 'ARB',
  optimism: 'OP', 'matic-network': 'MATIC', aptos: 'APT', sui: 'SUI',
  celestia: 'TIA', 'injective-protocol': 'INJ', 'sei-network': 'SEI',
  'jupiter-exchange': 'JUP', 'jito-governance-magnet': 'JTO', raydium: 'RAY',
  marinade: 'MNDE', pendle: 'PENDLE', eigenlayer: 'EIGEN', ethena: 'ENA',
  'ondo-finance': 'ONDO', mapletoken: 'MPL', 'render-token': 'RNDR',
  'fet-ai': 'FET', 'akash-network': 'AKT', bittensor: 'TAO',
  singularitynet: 'AGIX', worldcoin: 'WLD', wormhole: 'W',
  layerzero: 'ZRO', 'stargate-finance': 'STG', synthetix: 'SNX',
  gmx: 'GMX', dydx: 'DYDX', 'curve-dao-token': 'CRV',
  'compound-governance-token': 'COMP', 'yearn-finance': 'YFI',
  sushiswap: 'SUSHI', '1inch': '1INCH',
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
