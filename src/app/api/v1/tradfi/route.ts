// ─────────────────────────────────────────────────────────────
// TradFi API Route — SEC EDGAR + FRED macro data
// §2.3 — Public endpoint for traditional finance data
// ─────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import '@/lib/dal/tradfi' // trigger auto-register
import {
  searchCompany,
  getCompanyFacts,
  getRecentFilings,
} from '@/lib/dal/tradfi/sec-edgar'
import {
  getFredSeriesData,
  getFredLatestValue,
  getFredSeriesMeta,
} from '@/lib/dal/tradfi/fred'

// ─── Handler ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    switch (action) {
      // ── SEC EDGAR: company search ─────────────────────
      case 'sec-search': {
        const q = searchParams.get('q')
        if (!q) return apiError('Missing required param: q', 400)
        const results = await searchCompany(q)
        return apiSuccess(results)
      }

      // ── SEC EDGAR: company facts (XBRL) ──────────────
      case 'sec-facts': {
        const cik = searchParams.get('cik')
        if (!cik) return apiError('Missing required param: cik', 400)
        const facts = await getCompanyFacts(cik)
        return apiSuccess({
          cik: facts.cik,
          entityName: facts.entityName,
          // Return a summary — full facts payload is very large
          availableSchemas: Object.keys(facts.facts),
          usGaapSample: Object.keys(facts.facts['us-gaap'] ?? {}).slice(0, 30),
        })
      }

      // ── SEC EDGAR: recent filings ────────────────────
      case 'sec-filings': {
        const cik = searchParams.get('cik')
        if (!cik) return apiError('Missing required param: cik', 400)
        const filings = await getRecentFilings(cik)
        return apiSuccess(filings)
      }

      // ── FRED: series data ────────────────────────────
      case 'fred': {
        const series = searchParams.get('series')
        if (!series) return apiError('Missing required param: series', 400)
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '10') || 10))
        const data = await getFredSeriesData(series, limit)
        return apiSuccess(data)
      }

      // ── FRED: latest value ───────────────────────────
      case 'fred-latest': {
        const series = searchParams.get('series')
        if (!series) return apiError('Missing required param: series', 400)
        const latest = await getFredLatestValue(series)
        return apiSuccess({ series, latest })
      }

      // ── FRED: available series ───────────────────────
      case 'fred-meta': {
        return apiSuccess(getFredSeriesMeta())
      }

      default:
        return apiError(
          'Unknown action. Use: sec-search, sec-facts, sec-filings, fred, fred-latest, fred-meta',
          400,
        )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('GET /api/v1/tradfi error:', message)
    return apiError(message, 500)
  }
}
