// ─────────────────────────────────────────────────────────────
// Module: ECB SDW (Statistical Data Warehouse)
// sourceType: public-api
// Endpoint: sdw-wsrest.ecb.europa.eu/service
// Coverage: EUR/USD, euro area monetary aggregates, ECB key rates
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://sdw-wsrest.ecb.europa.eu/service/data'

async function fetchECB(params: FetchParams): Promise<unknown> {
  const series = (params.series as string) ?? 'EXR.D.USD.EUR.SP00.A'
  const last = (params.limit as number) ?? 30

  const url = `${BASE}/${series}?lastObs=${last}&format=structuredata`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`ECB SDW ${res.status}: ${series}`)
  const json = await res.json() as Record<string, unknown>
  return json
}

const ecbSdwModule: DataModule = {
  id: 'ecb-sdw',
  name: 'ECB Statistical Data Warehouse',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'ECB Statistical Data Warehouse — EUR/USD, euro area monetary aggregates, ECB key rates',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const url = `${BASE}/EXR.D.USD.EUR.SP00.A?lastObs=1&format=structuredata`
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'ecb-sdw',
      params,
      TTL.MACRO_DATA,
      () => fetchECB(params) as Promise<T>,
    )
  },
}

export default ecbSdwModule
