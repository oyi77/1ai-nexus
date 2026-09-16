// ─────────────────────────────────────────────────────────────
// Ajaib IDX Analysis Provider — analyst consensus, PE/PBV bands,
// technical summary per symbol. Keyless, no auth. SERVER-ONLY.
// Consume via /api/v1/saham/ajaib?symbol=BBRI.
//
// Source: external-api.ajaib.co.id/api/v1/public/investment-experience
// (iPhone UA required — desktop UA gets Cloudflare 403).
// Server revalidates 60s; data is slow-moving → 1h local cache.
// NOTE: analysis payload is ONLY populated for IDX STOCK
// (FOREIGN_STOCK/MF return HTTP 200 with empty result{}).
// Live-verified 2026-09-15.
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'

const BASE = 'https://external-api.ajaib.co.id/api/v1/public/investment-experience'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const CACHE_TTL = 60 * 60_000

/** Normalize user input: 'BBCA.JK'/'bbri' → 'BBRI'. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\.JK$/, '')
}

export interface AnalystRating {
  recommendation: string
  buy: number
  sell: number
  hold: number
  total: number
}

export interface PriceEstimates {
  target: number | null
  current: number | null
  high: number | null
  low: number | null
}

export interface ConsensusYear {
  revenue: number | null
  operatingIncome: number | null
  netIncome: number | null
  eps: number | null
}

export interface ValueBand {
  mean: number | null
  plus1: number | null
  plus2: number | null
  minus1: number | null
  minus2: number | null
  /** daily series, date → multiple */
  series: Record<string, number>
}

export interface IndicatorRow {
  name: string
  action: string
  value: number | null
}

export interface AjaibAnalysis {
  code: string
  capturedAt: string
  source?: 'db' | 'live'
  analystRating: AnalystRating | null
  priceEstimates: PriceEstimates | null
  consensus: Record<string, ConsensusYear>
  pbvBand: ValueBand | null
  peBand: ValueBand | null
  technicals: {
    buy: number
    sell: number
    neutral: number
    ma: IndicatorRow[]
    indicators: IndicatorRow[]
    pivots: IndicatorRow[]
  } | null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const numStr = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toRow(r: unknown): IndicatorRow | null {
  if (typeof r !== 'object' || r === null) return null
  const o = r as Record<string, unknown>
  if (typeof o.name !== 'string') return null
  return {
    name: o.name,
    action: typeof o.action === 'string' ? o.action : 'NONE',
    value: numStr(o.value),
  }
}

function toRows(v: unknown): IndicatorRow[] {
  if (!Array.isArray(v)) return []
  const out: IndicatorRow[] = []
  for (const r of v) {
    const row = toRow(r)
    if (row) out.push(row)
  }
  return out
}

function toBand(v: unknown, seriesKey: string): ValueBand | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const sd =
    typeof o.standard_deviations === 'object' && o.standard_deviations !== null
      ? (o.standard_deviations as Record<string, unknown>)
      : {}
  const rawSeries =
    typeof o[seriesKey] === 'object' && o[seriesKey] !== null
      ? (o[seriesKey] as Record<string, unknown>)
      : {}
  const series: Record<string, number> = {}
  for (const [k, val] of Object.entries(rawSeries)) {
    const n = num(val)
    if (n !== null) series[k] = n
  }
  return {
    mean: num(sd.mean),
    plus1: num(sd.mean_plus1),
    plus2: num(sd.mean_plus2),
    minus1: num(sd.mean_minus1),
    minus2: num(sd.mean_minus2),
    series,
  }
}

/** Pure parser — unit-testable, no network. Returns null on error envelope or empty result. */
export function parseAnalysisPayload(code: string, payload: unknown): AjaibAnalysis | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (p.err_code !== 'EC0000000') return null
  const stock = (p.result as Record<string, unknown> | undefined)?.stock
  if (typeof stock !== 'object' || stock === null) return null
  const s = stock as Record<string, unknown>
  // Unknown/illiquid codes: 200 + all section bodies EMPTY —
  // analysts_estimates[], pbv/pe as {} (no standard_deviations),
  // technicals all-zero + empty lists, NO consensus years.
  // Treat as "no data" (null → route 404), not an empty analysis.
  const estRaw = s.analysts_estimates
  const hasEstimates =
    typeof estRaw === 'object' && estRaw !== null && !Array.isArray(estRaw) && Object.keys(estRaw).length > 0
  const pbvSd = (s.pbv_band as Record<string, unknown> | undefined)?.standard_deviations
  const hasPbv = typeof pbvSd === 'object' && pbvSd !== null && Object.keys(pbvSd).length > 0
  if (!hasEstimates && !hasPbv) return null
  const est =
    typeof s.analysts_estimates === 'object' && s.analysts_estimates !== null
      ? (s.analysts_estimates as Record<string, unknown>)
      : {}
  const rating =
    typeof est.analysts_rating === 'object' && est.analysts_rating !== null
      ? (est.analysts_rating as Record<string, unknown>)
      : null
  const pe =
    typeof est.price_estimates === 'object' && est.price_estimates !== null
      ? (est.price_estimates as Record<string, unknown>)
      : null
  const rawConsensus =
    typeof est.analysts_consensus_estimates === 'object' && est.analysts_consensus_estimates !== null
      ? (est.analysts_consensus_estimates as Record<string, Record<string, unknown>>)
      : {}
  const consensus: Record<string, ConsensusYear> = {}
  for (const [year, y] of Object.entries(rawConsensus)) {
    consensus[year] = {
      revenue: num(y.revenue),
      operatingIncome: num(y.operating_income),
      netIncome: num(y.net_income),
      eps: num(y.eps),
    }
  }

  const tech =
    typeof s.technical_indicator === 'object' && s.technical_indicator !== null
      ? (s.technical_indicator as Record<string, unknown>)
      : null

  return {
    code,
    capturedAt: new Date().toISOString(),
    analystRating: rating
      ? {
          recommendation: typeof rating.recommendation === 'string' ? rating.recommendation : 'UNKNOWN',
          buy: num(rating.total_analyst_buy_rec) ?? 0,
          sell: num(rating.total_analyst_sell_rec) ?? 0,
          hold: num(rating.total_analyst_hold_rec) ?? 0,
          total: num(rating.total_analysts) ?? 0,
        }
      : null,
    priceEstimates: pe
      ? {
          target: num(pe.target),
          current: num(pe.current),
          high: num(pe.high),
          low: num(pe.low),
        }
      : null,
    consensus,
    pbvBand: toBand(s.pbv_band, 'price_to_book_value'),
    peBand: toBand(s.pe_band, 'price_to_earnings'),
    technicals: tech
      ? {
          buy: num(tech.buy_summary) ?? 0,
          sell: num(tech.sell_summary) ?? 0,
          neutral: num(tech.neutral_summary) ?? 0,
          ma: toRows(tech.ma),
          indicators: toRows(tech.technical_indicator),
          pivots: toRows(tech.ppi),
        }
      : null,
  }
}
async function fetchAnalysis(code: string): Promise<AjaibAnalysis | null> {
  const res = await fetch(`${BASE}/asset/analysis?asset_type=STOCK&code=${code}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': IPHONE_UA, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Ajaib analysis HTTP ${res.status} for ${code}`)
  const parsed = parseAnalysisPayload(code, await res.json())
  return parsed ? { ...parsed, source: 'live' as const } : parsed
}

function dbRowToAnalysis(r: {
  code: string
  snapshotDate: string
  recommendation: string
  buy: number
  sell: number
  hold: number
  total: number
  targetPrice: number | null
  currentPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  consensus: unknown
  technicals: unknown
  bands: unknown
}): AjaibAnalysis {
  const consensus =
    typeof r.consensus === 'object' && r.consensus !== null
      ? (r.consensus as Record<string, ConsensusYear>)
      : {}
  const tech =
    typeof r.technicals === 'object' && r.technicals !== null
      ? (r.technicals as { buy: number; sell: number; neutral: number; ma: IndicatorRow[]; indicators: IndicatorRow[]; pivots: IndicatorRow[] })
      : null
  const bands =
    typeof r.bands === 'object' && r.bands !== null
      ? (r.bands as { pbv: ValueBand | null; pe: ValueBand | null })
      : { pbv: null, pe: null }
  return {
    code: r.code,
    capturedAt: new Date(`${r.snapshotDate}T00:00:00Z`).toISOString(),
    source: 'db',
    analystRating: {
      recommendation: r.recommendation || 'UNKNOWN',
      buy: r.buy,
      sell: r.sell,
      hold: r.hold,
      total: r.total,
    },
    priceEstimates: {
      target: r.targetPrice,
      current: r.currentPrice,
      high: r.highPrice,
      low: r.lowPrice,
    },
    consensus,
    pbvBand: bands.pbv ?? null,
    peBand: bands.pe ?? null,
    technicals: tech,
  }
}

/**
 * DB-first: serve the nightly harvest snapshot; live-fetch only when
 * the DB has no snapshot for this code yet.
 */
export async function getAjaibAnalysis(input: string): Promise<AjaibAnalysis | null> {
  const code = normalizeCode(input)
  if (!/^[A-Z0-9]{3,6}$/.test(code)) return null
  // v2: 200-with-empty-sections (unknown codes) now parses to null.
  // Bumped so stale pre-fix non-null entries are never served.
  const { data } = await getCached(`ajaib-analysis:v2:${code}`, CACHE_TTL, async () => {
    const row = await prisma.idxAjaibConsensus.findFirst({
      where: { code },
      orderBy: { snapshotDate: 'desc' },
    })
    if (row) return dbRowToAnalysis(row)
    return fetchAnalysis(code)
  })
  return data
}
