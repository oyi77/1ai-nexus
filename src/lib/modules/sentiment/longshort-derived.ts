// ─────────────────────────────────────────────────────────────
// Module: Long/Short Derived
// sourceType: derived
// Computes: Aggregated long/short ratio from Binance public API
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

interface LongShortData {
  symbol: string
  ratio: number
  longPct: number
  shortPct: number
  timestamp: string
}

async function fetchLongShort(params: FetchParams): Promise<LongShortData[]> {
  const registry = getRegistry()
  const symbols = ((params.symbols as string) ?? 'BTCUSDT,ETHUSDT,SOLUSDT').split(',')

  const results = await Promise.allSettled(
    symbols.map(sym =>
      registry.fetchOne<Array<{ longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }>>(
        'binance',
        { action: 'long-short', symbol: sym, period: '1h', limit: '1' }
      )
    )
  )

  return results
    .filter((r): r is PromiseFulfilledResult<ModuleResult<Array<{ longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }>>> => r.status === 'fulfilled')
    .map((r, i) => {
      const latest = r.value.data?.[0]
      return {
        symbol: symbols[i],
        ratio: latest ? Number(latest.longShortRatio) : 0,
        longPct: latest ? Number(latest.longAccount) * 100 : 50,
        shortPct: latest ? Number(latest.shortAccount) * 100 : 50,
        timestamp: latest ? new Date(latest.timestamp).toISOString() : new Date().toISOString(),
      }
    })
}

const longShortModule: DataModule = {
  id: 'longshort-derived',
  name: 'Long/Short Ratio (Derived)',
  category: 'sentiment',
  sourceType: 'derived',
  provenance: {
    describesItself: 'Aggregated long/short ratio from Binance public futures API',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'longshort-derived',
      params,
      TTL.DERIVATIVES,
      () => fetchLongShort(params) as Promise<T>,
    )
  },
}

export default longShortModule
