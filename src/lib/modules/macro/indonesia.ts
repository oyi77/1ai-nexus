// ─────────────────────────────────────────────────────────────
// Module: Indonesian Macro Data (World Bank)
// sourceType: public-api
// Endpoint: api.worldbank.org/v2
// Coverage: GDP, CPI, Unemployment, Population, Trade Balance, FDI
// Free, no API key required.
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.worldbank.org/v2'
const COUNTRY = 'IDN' // Indonesia

interface WorldBankObs {
  date: string
  value: number | null
  indicator: { id: string; value: string }
}

interface WorldBankResponse {
  [0]: unknown
  [1]: WorldBankObs[] | null
}

export const INDONESIA_INDICATORS: Record<string, { wbId: string; title: string; unit: string; category: string; transform: (v: number) => string }> = {
  'IDN-GDP': {
    wbId: 'NY.GDP.MKTP.CD',
    title: 'Indonesia GDP (current US$)',
    unit: '$B',
    category: 'growth',
    transform: (v) => (v / 1e9).toFixed(1),
  },
  'IDN-GDP-GROWTH': {
    wbId: 'NY.GDP.MKTP.KD.ZG',
    title: 'Indonesia GDP Growth Rate',
    unit: '%',
    category: 'growth',
    transform: (v) => v.toFixed(1),
  },
  'IDN-CPI': {
    wbId: 'FP.CPI.TOTL',
    title: 'Indonesia Consumer Price Index',
    unit: 'Index',
    category: 'inflation',
    transform: (v) => v.toFixed(2),
  },
  'IDN-INFLATION': {
    wbId: 'FP.CPI.TOTL.ZG',
    title: 'Indonesia Inflation Rate',
    unit: '%',
    category: 'inflation',
    transform: (v) => v.toFixed(1),
  },
  'IDN-UNEMPLOYMENT': {
    wbId: 'SL.UEM.TOTL.ZS',
    title: 'Indonesia Unemployment Rate',
    unit: '%',
    category: 'employment',
    transform: (v) => v.toFixed(1),
  },
  'IDN-POPULATION': {
    wbId: 'SP.POP.TOTL',
    title: 'Indonesia Population',
    unit: 'M',
    category: 'demographics',
    transform: (v) => (v / 1e6).toFixed(1),
  },
  'IDN-TRADE-BALANCE': {
    wbId: 'BN.CAB.XOKA.GD.ZS',
    title: 'Indonesia Current Account Balance',
    unit: '% GDP',
    category: 'trade',
    transform: (v) => v.toFixed(2),
  },
  'IDN-FDI': {
    wbId: 'BX.KLT.DINV.WD.GD.ZS',
    title: 'Indonesia Foreign Direct Investment',
    unit: '% GDP',
    category: 'investment',
    transform: (v) => v.toFixed(2),
  },
}

function isWorldBankResponse(json: unknown): json is WorldBankResponse {
  return Array.isArray(json) && json.length === 2 && Array.isArray(json[1])
}

async function fetchIndonesiaIndicator(
  indicatorId: string,
  limit: number,
): Promise<{ date: string; value: string }[]> {
  const meta = INDONESIA_INDICATORS[indicatorId]
  if (!meta) return []

  const url = `${BASE}/country/${COUNTRY}/indicator/${meta.wbId}?format=json&per_page=${Math.max(limit * 2, 20)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return []

  const json: unknown = await res.json()
  if (!isWorldBankResponse(json) || !json[1]) return []

  return json[1]
    .filter(obs => obs.value !== null)
    .slice(0, limit)
    .map(obs => ({
      date: obs.date,
      value: meta.transform(obs.value as number),
    }))
}

async function fetchIndonesiaMacro(params: FetchParams): Promise<unknown> {
  const indicatorId = (params.indicator as string) ?? 'IDN-GDP'
  const limit = (params.limit as number) ?? 10

  const meta = INDONESIA_INDICATORS[indicatorId]
  if (!meta) return { indicatorId, observations: [] }

  const observations = await fetchIndonesiaIndicator(indicatorId, limit)
  return {
    indicatorId,
    title: meta.title,
    unit: meta.unit,
    category: meta.category,
    observations,
  }
}

const indonesiaModule: DataModule = {
  id: 'indonesia-macro',
  name: 'Indonesia Macro',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Indonesian macro-economic data from World Bank — GDP, CPI, inflation, unemployment, population, trade balance, FDI.',
    fragility: 'stable',
    lastVerified: '2026-06-30',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const url = `${BASE}/country/${COUNTRY}/indicator/NY.GDP.MKTP.CD?format=json&per_page=1`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'indonesia-macro',
      params,
      TTL.MACRO_DATA,
      () => fetchIndonesiaMacro(params) as Promise<T>,
    )
  },
}

export default indonesiaModule
