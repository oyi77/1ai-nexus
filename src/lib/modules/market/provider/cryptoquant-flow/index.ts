// ─────────────────────────────────────────────────────────────
// CryptoQuant Exchange Net Flow Provider
// BTC/ETH net flow to/from exchanges, normalized vs 30d baseline
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

const EXCHANGE_FLOW_URL = 'http://localhost:4400/api/v1/exchange-flow'

const INFLOW_BEARISH_THRESHOLD = 50_000_000   // $50M net inflow = bearish
const OUTFLOW_BULLISH_THRESHOLD = 50_000_000  // $50M net outflow = bullish

interface ExchangeFlowResponse {
  symbol: string
  netFlowUsd: number         // positive = inflow to exchanges
  percentile30d: number      // 0-100 percentile vs trailing 30d
  timestamp: string
}

async function fetchExchangeFlow(): Promise<ExchangeFlowResponse[]> {
  const res = await fetch(EXCHANGE_FLOW_URL, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return []
  const data = await res.json() as ExchangeFlowResponse[]
  return Array.isArray(data) ? data : []
}

function normalizePercentile(percentile: number): number {
  return Math.max(0, Math.min(100, percentile))
}

function getDirection(netFlowUsd: number): 'bullish' | 'bearish' | 'neutral' {
  if (netFlowUsd > INFLOW_BEARISH_THRESHOLD) return 'bearish'    // Large inflow to exchanges
  if (netFlowUsd < -OUTFLOW_BULLISH_THRESHOLD) return 'bullish'  // Large outflow from exchanges
  return 'neutral'
}

function getHumanReadable(symbol: string, netFlowUsd: number): string {
  const abs = Math.abs(netFlowUsd)
  const formatted = abs >= 1_000_000_000
    ? `$${(abs / 1_000_000_000).toFixed(1)}B`
    : `$${(abs / 1_000_000).toFixed(0)}M`

  if (netFlowUsd < -OUTFLOW_BULLISH_THRESHOLD) {
    return `${symbol} ${formatted} net outflow from exchanges — accumulation signal`
  }
  if (netFlowUsd > INFLOW_BEARISH_THRESHOLD) {
    return `${symbol} ${formatted} net inflow to exchanges — distribution signal`
  }
  return `${symbol} exchange flow neutral (${formatted} net movement)`
}

class CryptoQuantFlowProvider implements MarketDataProvider {
  readonly id = 'cryptoquant-flow'
  readonly tier = 'onchain' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const cacheKey = `exchange-flow:${symbol}`

    const { data: flows } = await getCached(cacheKey, config.ttlMs, fetchExchangeFlow)
    const flow = flows.find(f => f.symbol === symbol)

    if (!flow) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol,
      market,
      rawValue: flow.netFlowUsd,
      normalizedScore: normalizePercentile(flow.percentile30d),
      direction: getDirection(flow.netFlowUsd),
      confidence: 0.7,
      fetchedAt: now,
      sourceTimestamp: flow.timestamp ?? now,
      humanReadable: getHumanReadable(symbol, flow.netFlowUsd),
    }
  }
}

export const cryptoquantFlowProvider = new CryptoQuantFlowProvider()
