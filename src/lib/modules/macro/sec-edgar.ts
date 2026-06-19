// ─────────────────────────────────────────────────────────────
// Module: SEC EDGAR
// sourceType: public-api
// Endpoint: data.sec.gov, efts.sec.gov
// Coverage: Company filings, XBRL financial data, full-text search — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://efts.sec.gov/LATEST/search-index'

async function secFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: {
      Accept: 'application/json',
      'User-Agent': '1AI-Nexus contact@example.com',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  return res.json() as Promise<T>
}

async function fetchSEC(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'filings'

  switch (action) {
    case 'filings': {
      const q = (params.q as string) ?? 'crypto OR bitcoin OR blockchain'
      const url = `${BASE}?q=${encodeURIComponent(q)}&dateRange=custom&startdt=2026-06-01&enddt=2026-06-20&forms=10-K,10-Q,8-K,S-1`
      return secFetch<unknown>(url)
    }
    case 'company': {
      const cik = params.cik as string
      return secFetch<unknown>(`https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`)
    }
    default:
      throw new Error(`SEC: unknown action ${action}`)
  }
}

const secEdgarModule: DataModule = {
  id: 'sec-edgar',
  name: 'SEC EDGAR',
  category: 'news',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'SEC EDGAR — company filings, XBRL financial data, full-text search across all SEC filings',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await secFetch('https://data.sec.gov/submissions/CIK0000320193.json')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('sec-edgar', params, TTL.MACRO_DATA, () => fetchSEC(params) as Promise<T>)
  },
}

export default secEdgarModule
