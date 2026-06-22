/**
 * Module: US Treasury Yield Curve
 * sourceType: public-api
 * upstreamProduct: US Department of the Treasury
 * endpoint: home.treasury.gov/resource-center/data-chart-center/interest-rates
 * discoveredVia: docs
 * lastVerified: 2026-06-20
 * UNOFFICIAL: parses Treasury's daily yield curve CSV (fiscaldata API is IP-blocked from some servers)
 * fallbackFn: empty yield curve
 *
 * Alpha signals: yield curve slope (10y-2y), inversion = recession
 * indicator. Absolute core macro data for any trading system.
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const CSV_URL = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2025/all?type=daily_treasury_yield_curve&field_tdr_date_value=2025'

interface TreasuryYield {
  securityType: string
  avgInterestRateAmt: number | null
  recordDate: string
}

interface TreasuryData {
  yields: TreasuryYield[]
  curve: {
    oneMo: number | null
    twoMo: number | null
    threeMo: number | null
    sixMo: number | null
    oneYr: number | null
    twoYr: number | null
    threeYr: number | null
    fiveYr: number | null
    sevenYr: number | null
    tenYr: number | null
    twentyYr: number | null
    thirtyYr: number | null
  }
  tenYrTwoYrSpread: number | null
  timestamp: number
}

const COLUMN_MAP: Record<string, string> = {
  '1 Mo': 'oneMo',
  '1.5 Month': 'twoMo',
  '2 Mo': 'twoMo',
  '3 Mo': 'threeMo',
  '4 Mo': 'threeMo',
  '6 Mo': 'sixMo',
  '1 Yr': 'oneYr',
  '2 Yr': 'twoYr',
  '3 Yr': 'threeYr',
  '5 Yr': 'fiveYr',
  '7 Yr': 'sevenYr',
  '10 Yr': 'tenYr',
  '30 Yr': 'thirtyYr',
}

const _COLUMN_ORDER = ['1 Mo', '1.5 Month', '2 Mo', '3 Mo', '4 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '5 Yr', '7 Yr', '10 Yr', '20 Yr', '30 Yr']

async function fetchTreasury(_params: FetchParams): Promise<TreasuryData> {
  const res = await fetch(CSV_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10_000),
  })

  const yields: TreasuryYield[] = []
  const curve: TreasuryData['curve'] = {
    oneMo: null, twoMo: null, threeMo: null, sixMo: null,
    oneYr: null, twoYr: null, threeYr: null, fiveYr: null,
    sevenYr: null, tenYr: null, twentyYr: null, thirtyYr: null,
  }

  if (res.ok) {
    const csv = await res.text()
    const lines = csv.trim().split('\n')

    if (lines.length > 1) {
      // Parse header
      const headers = parseCsvLine(lines[0])
      // Latest data is second line (sorted desc)
      const dataLine = lines[1]
      const values = parseCsvLine(dataLine)
      const date = values[0] ?? ''

      for (let i = 1; i < headers.length && i < values.length; i++) {
        const header = headers[i].replace(/"/g, '').trim()
        const val = parseFloat(values[i].replace(/"/g, ''))
        if (isNaN(val)) continue

        const key = COLUMN_MAP[header]
        if (key && key in curve) {
          (curve as Record<string, number | null>)[key] = val
          yields.push({
            securityType: header,
            avgInterestRateAmt: val,
            recordDate: date,
          })
        }
      }
    }
  }

  const tenYrTwoYrSpread = curve.tenYr != null && curve.twoYr != null
    ? curve.tenYr - curve.twoYr
    : null

  return { yields, curve, tenYrTwoYrSpread, timestamp: Date.now() }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue }
    current += ch
  }
  result.push(current)
  return result
}

const treasuryModule: DataModule = {
  id: 'us-treasury',
  name: 'US Treasury Yield Curve',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'US Treasury yield curve data — 1mo to 30yr rates, 10y-2y spread (from CSV)',
    upstreamProduct: 'US Treasury Daily Yield Curve',
    discoveredVia: 'docs',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(6_000) })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('us-treasury', params, TTL.MACRO_DATA, () => fetchTreasury(params) as Promise<T>)
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: {
        yields: [],
        curve: { oneMo: null, twoMo: null, threeMo: null, sixMo: null, oneYr: null, twoYr: null, threeYr: null, fiveYr: null, sevenYr: null, tenYr: null, twentyYr: null, thirtyYr: null },
        tenYrTwoYrSpread: null, timestamp: Date.now(),
      } as unknown as T,
      source: 'us-treasury (empty fallback)', cached: false, timestamp: Date.now(), ttl: TTL.MACRO_DATA,
    }
  },
}

export default treasuryModule
