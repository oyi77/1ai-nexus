import { SECTORS_APP_FALLBACK_SYMBOLS } from '@/lib/config/universe'

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import yahooFinanceModule from '../equities/yahoo/quotes'

async function fetchSectorsRSC(): Promise<unknown> {
  const url = 'https://sectors.app/indonesia/indeks'
  const res = await fetch(url, {
    headers: {
      'RSC': '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://sectors.app/'
    },
    signal: AbortSignal.timeout(10_000)
  })

  if (!res.ok) {
    throw new Error(`Sectors.app RE failed with status ${res.status}`)
  }

  const text = await res.text()
  return { rawRsc: text }
}

async function fetchSectors(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'indeks'
  
  if (action === 'indeks') {
    try {
      const data = await fetchSectorsRSC()
      return data
    } catch (e) {
      console.warn('Sectors.app RSC failed, falling back to Yahoo Finance', e)
      const yfRes = await yahooFinanceModule.fetch({
        action: 'quote',
        symbols: SECTORS_APP_FALLBACK_SYMBOLS.join(',')
      })
      return yfRes.data
    }
  }
  
  throw new Error(`Sectors.app: unknown action ${action}`)
}

const sectorsAppModule: DataModule = {
  id: 'sectors-app',
  name: 'Sectors App',
  category: 'market',
  sourceType: 're',
  provenance: {
    describesItself: 'Sectors.app RE for Indonesia index and sectors',
    fragility: 'fragile',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await fetchSectorsRSC()
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return { data: [] as unknown as T, source: 'sectors-app (cached)', cached: true, timestamp: Date.now(), ttl: TTL.PRICE_DATA }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'sectors-app',
      params,
      TTL.PRICE_DATA,
      () => fetchSectors(params) as Promise<T>,
    )
  },
}

export default sectorsAppModule
