// ─────────────────────────────────────────────────────────────
// TradFi DAL Sources — register all traditional finance sources
// §2.0 — SEC EDGAR + FRED integration with DAL registry
// ─────────────────────────────────────────────────────────────

import { getDalRegistry, type DalSource } from '@/lib/dal/registry'
import { searchCompany, getCompanyFacts, getRecentFilings } from './sec-edgar'
import { getFredSeriesData, getFredLatestValue, getFredSeriesMeta } from './fred'

// ─── SEC EDGAR source ──────────────────────────────────────

const secEdgarSource: DalSource = {
  id: 'sec-edgar',
  name: 'SEC EDGAR',
  domain: 'tradfi-filings',
  tier: 0,
  rateLimit: { maxRequests: 10, windowMs: 1000 },
  cacheTtlMs: 60 * 60 * 1000, // 1 hour
  healthCheck: async () => {
    try {
      const res = await fetch('https://efts.sec.gov/LATEST/search-index?q=apple', {
        headers: { 'User-Agent': '1ai-tracker (contact@aitradepulse.com)' },
        signal: AbortSignal.timeout(5000),
      })
      return res.ok
    } catch {
      // Health check: false means unreachable, no need to log
      return false
    }
  },
  fetch: async (params) => {
    const action = params.action as string
    switch (action) {
      case 'search':
        return searchCompany(params.q as string ?? '')
      case 'facts':
        return getCompanyFacts(params.cik as string ?? '')
      case 'filings':
        return getRecentFilings(params.cik as string ?? '')
      default:
        throw new Error(`Unknown SEC EDGAR action: ${action}`)
    }
  },
}

// ─── FRED source ───────────────────────────────────────────

const fredSource: DalSource = {
  id: 'fred',
  name: 'Federal Reserve Economic Data',
  domain: 'tradfi-macro',
  tier: 0,
  rateLimit: { maxRequests: 30, windowMs: 60_000 }, // World Bank rate limit
  cacheTtlMs: 30 * 60 * 1000, // 30 minutes
  healthCheck: async () => {
    try {
      const obs = await getFredLatestValue('UNRATE')
      return obs !== null
    } catch {
      return false
    }
  },
  fetch: async (params) => {
    const series = params.series as string ?? 'FEDFUNDS'
    const limit = typeof params.limit === 'number' ? params.limit : 10
    const action = params.action as string

    if (action === 'latest') return getFredLatestValue(series)
    if (action === 'meta') return getFredSeriesMeta()
    return getFredSeriesData(series, limit)
  },
}

// ─── Registration ──────────────────────────────────────────

/**
 * Register all TradFi data sources with the DAL registry.
 * Idempotent — safe to call multiple times.
 */
export function registerTradFiSources(): void {
  const registry = getDalRegistry()
  registry.registerAll([secEdgarSource, fredSource])
}

// Auto-register on import (mirrors fx/ecb pattern)
registerTradFiSources()
