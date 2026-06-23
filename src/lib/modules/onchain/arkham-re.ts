/**
 * Module: Arkham Intelligence
 * sourceType: re
 * upstreamProduct: Arkham Intelligence
 * endpoint: intel.arkham.io dashboard endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Arkham's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: entity-labels-derived (seed data)
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getEntityLabel } from '../ai-signals/entity-labels-seed'

const BASE = 'https://intel.arkham.io'

async function arkhamFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Arkham ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchArkham(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'entity'

  switch (action) {
    case 'entity': {
      const address = params.address as string
      if (!address) throw new Error('Arkham: address required')
      try {
        return await arkhamFetch<unknown>(`/api/entities/address/${address}`)
      } catch {
        // Fallback to seed data
        const label = await getEntityLabel(address, (params.chain as string) ?? 'eth')
        return label ? { label: label.label, category: label.category, confidence: label.confidence } : null
      }
    }
    case 'search': {
      const q = params.q as string
      return arkhamFetch<unknown>(`/api/entities/search?q=${encodeURIComponent(q)}`)
    }
    default:
      throw new Error(`Arkham: unknown action ${action}`)
  }
}

const arkhamModule: DataModule = {
  id: 'arkham-re',
  name: 'Arkham Intelligence',
  category: 'onchain',
  sourceType: 're',
  provenance: {
    describesItself: 'Arkham Intelligence entity labels — wallet-to-entity mapping for known funds, exchanges, protocols',
    upstreamProduct: 'Arkham Intelligence',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await arkhamFetch('/api/entities/search?q=binance')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using seed data fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'arkham-re',
      params,
      TTL.ENTITY_LABEL * TTL.RE_MULTIPLIER,
      () => fetchArkham(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const address = params.address as string
    const chain = (params.chain as string) ?? 'eth'
    const label = address ? await getEntityLabel(address, chain) : undefined
    return {
      data: (label ? { label: label.label, category: label.category } : { label: 'Unknown', category: 'unknown' }) as T,
      source: 'arkham-re (seed fallback)',
      cached: true,
      timestamp: Date.now(),
      ttl: TTL.ENTITY_LABEL,
    }
  },
}

export default arkhamModule
