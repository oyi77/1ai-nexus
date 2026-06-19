// ─────────────────────────────────────────────────────────────
// Module: Mempool.space
// sourceType: public-api
// Endpoint: mempool.space/api
// Coverage: Bitcoin mempool, fees, blocks, transactions — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://mempool.space/api'

async function mempoolFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Mempool.space ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchMempool(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'fees'

  switch (action) {
    case 'fees':
      return mempoolFetch<unknown>('/v1/fees/recommended')
    case 'mempool':
      return mempoolFetch<unknown>('/mempool')
    case 'blocks':
      return mempoolFetch<unknown>('/v1/blocks')
    case 'hashrate':
      return mempoolFetch<unknown>('/v1/mining/hashrate/1m')
    case 'difficulty':
      return mempoolFetch<unknown>('/v1/difficulty-adjustment')
    default:
      throw new Error(`Mempool.space: unknown action ${action}`)
  }
}

const mempoolModule: DataModule = {
  id: 'mempool-space',
  name: 'Mempool.space',
  category: 'onchain',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Mempool.space — Bitcoin mempool, fees, blocks, hashrate, difficulty adjustment',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await mempoolFetch('/v1/fees/recommended')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('mempool-space', params, TTL.DERIVATIVES, () => fetchMempool(params) as Promise<T>)
  },
}

export default mempoolModule
