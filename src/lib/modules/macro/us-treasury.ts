// ─────────────────────────────────────────────────────────────
// Module: US Treasury Fiscal Data
// sourceType: public-api
// Endpoint: api.fiscaldata.treasury.gov
// Coverage: US debt, revenue, spending, exchange rates — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service'

async function treasuryFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Treasury ${res.status}`)
  return res.json() as Promise<T>
}

async function fetchTreasury(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'debt'

  switch (action) {
    case 'debt':
      return treasuryFetch<unknown>('/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=10')
    case 'revenue':
      return treasuryFetch<unknown>('/v1/accounting/od/receipts_by_category?sort=-record_date&page[size]=10')
    case 'rates':
      return treasuryFetch<unknown>('/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=20')
    default:
      throw new Error(`Treasury: unknown action ${action}`)
  }
}

const treasuryModule: DataModule = {
  id: 'us-treasury',
  name: 'US Treasury Fiscal Data',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'US Treasury Fiscal Data — national debt, revenue, spending, interest rates',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await treasuryFetch('/v2/accounting/od/debt_to_penny?page[size]=1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('us-treasury', params, TTL.MACRO_DATA, () => fetchTreasury(params) as Promise<T>)
  },
}

export default treasuryModule
