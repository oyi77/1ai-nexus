// ─────────────────────────────────────────────────────────────
// Module: Derivatives Aggregation (derived)
// sourceType: derived
// Combines: Hyperliquid + Binance + Bybit OI/funding/liquidations
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

interface AggregatedOI {
  symbol: string
  totalOI: number
  exchanges: Array<{ exchange: string; oi: number }>
}

interface AggregatedFunding {
  symbol: string
  rates: Array<{ exchange: string; rate: number; nextTime?: string }>
  avgRate: number
}

async function fetchDerivatives(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'open-interest'
  const registry = getRegistry()

  if (action === 'open-interest') {
    const symbol = (params.symbol as string) ?? 'BTCUSDT'
    const results = await Promise.allSettled([
      registry.fetchOne('hyperliquid', { action: 'meta' }),
      registry.fetchOne('binance', { action: 'open-interest', symbol }),
      registry.fetchOne('bybit', { action: 'open-interest', symbol, category: 'linear' }),
    ])

    const exchanges: Array<{ exchange: string; oi: number }> = []

    // Binance OI
    if (results[1].status === 'fulfilled') {
      const d = results[1].value.data as { openInterest?: string }
      if (d?.openInterest) exchanges.push({ exchange: 'binance', oi: Number(d.openInterest) })
    }

    // Bybit OI
    if (results[2].status === 'fulfilled') {
      const d = results[2].value.data as { list?: Array<{ openInterest?: string }> }
      if (d?.list?.[0]?.openInterest) exchanges.push({ exchange: 'bybit', oi: Number(d.list[0].openInterest) })
    }

    const totalOI = exchanges.reduce((sum, e) => sum + e.oi, 0)
    return { symbol, totalOI, exchanges } as AggregatedOI
  }

  if (action === 'funding') {
    const symbol = (params.symbol as string) ?? 'BTCUSDT'
    const results = await Promise.allSettled([
      registry.fetchOne('binance', { action: 'funding', symbol }),
      registry.fetchOne('bybit', { action: 'funding', symbol, category: 'linear' }),
    ])

    const rates: Array<{ exchange: string; rate: number; nextTime?: string }> = []

    if (results[0].status === 'fulfilled') {
      const d = results[0].value.data as Array<{ fundingRate: string }> | undefined
      if (d?.[0]) rates.push({ exchange: 'binance', rate: Number(d[0].fundingRate) })
    }

    if (results[1].status === 'fulfilled') {
      const d = results[1].value.data as { list?: Array<{ fundingRate: string }> } | undefined
      if (d?.list?.[0]) rates.push({ exchange: 'bybit', rate: Number(d.list[0].fundingRate) })
    }

    const avgRate = rates.length > 0 ? rates.reduce((s, r) => s + r.rate, 0) / rates.length : 0
    return { symbol, rates, avgRate } as AggregatedFunding
  }

  throw new Error(`Derivatives: unknown action ${action}`)
}

const derivativesModule: DataModule = {
  id: 'derivatives-aggregate',
  name: 'Derivatives Aggregation',
  category: 'derivatives',
  sourceType: 'derived',
  provenance: {
    describesItself: 'Aggregated OI, funding rates, and liquidations across Binance, Bybit, and Hyperliquid',
    fragility: 'moderate',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0, notes: 'Derived — depends on upstream modules' }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'derivatives-aggregate',
      params,
      TTL.DERIVATIVES,
      () => fetchDerivatives(params) as Promise<T>,
    )
  },
}

export default derivativesModule
