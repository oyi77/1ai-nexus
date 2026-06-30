// ─── Macro-Economic Data Client ────────────────────────────
// Sources (priority order — free first, FRED API second):
//   1. U.S. Treasury yield curve CSV (free, no key) for yields
//   2. World Bank API (free, no key) for GDP, CPI, Unemployment
//   3. FRED API (free key from fred.stlouisfed.org) for everything else
// Set FRED_API_KEY env var for full 22-series coverage.
// ─────────────────────────────────────────────────────────

const FRED_API_KEY = process.env.FRED_API_KEY ?? ''
const FRED_API_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const TREASURY_CSV_URL = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv'
const WORLD_BANK_BASE = 'https://api.worldbank.org/v2'

// ─── Types ────────────────────────────────────────────────

export interface FredObservation {
  date: string
  value: string
}

export interface FredSeries {
  id: string
  title: string
  observations: FredObservation[]
}

// ─── Key FRED Series (metadata preserved for callers) ─────

export const FRED_SERIES: Record<string, { title: string; unit: string; category: string }> = {
  // ─── Rates (sourced from Treasury CSV — free, no key) ──
  FEDFUNDS:             { title: 'Federal Funds Effective Rate',              unit: '%',       category: 'rates' },
  DFF:                  { title: 'Federal Funds Effective Rate (Daily)',      unit: '%',       category: 'rates' },
  DGS2:                 { title: '2-Year Treasury Constant Maturity Rate',    unit: '%',       category: 'rates' },
  DGS3:                 { title: '3-Year Treasury Constant Maturity Rate',    unit: '%',       category: 'rates' },
  DGS5:                 { title: '5-Year Treasury Constant Maturity Rate',    unit: '%',       category: 'rates' },
  DGS7:                 { title: '7-Year Treasury Constant Maturity Rate',    unit: '%',       category: 'rates' },
  DGS10:                { title: '10-Year Treasury Constant Maturity Rate',   unit: '%',       category: 'rates' },
  DGS20:                { title: '20-Year Treasury Constant Maturity Rate',   unit: '%',       category: 'rates' },
  DGS30:                { title: '30-Year Treasury Constant Maturity Rate',   unit: '%',       category: 'rates' },
  T10Y2Y:               { title: '10Y-2Y Treasury Spread',                   unit: '%',       category: 'rates' },

  // ─── Inflation (FRED API) ──────────────────────────────
  CPIAUCSL:             { title: 'Consumer Price Index for All Urban Consumers', unit: 'Index', category: 'inflation' },
  T10YIE:               { title: '10-Year Breakeven Inflation Rate',          unit: '%',       category: 'inflation' },
  T5YIFR:               { title: '5-Year Forward Inflation Expectation Rate', unit: '%',       category: 'inflation' },

  // ─── Employment (UNRATE from World Bank, rest FRED API) ─
  UNRATE:               { title: 'Unemployment Rate',                         unit: '%',        category: 'employment' },
  ICSA:                 { title: 'Initial Jobless Claims',                    unit: 'Thousands', category: 'employment' },
  PAYEMS:               { title: 'Total Nonfarm Payrolls',                    unit: 'Thousands', category: 'employment' },

  // ─── Growth (GDP from World Bank, rest FRED API) ───────
  GDP:                  { title: 'Gross Domestic Product',                    unit: '$B',      category: 'growth' },
  INDPRO:               { title: 'Industrial Production Index',               unit: 'Index',   category: 'growth' },

  // ─── Real Estate (FRED API) ────────────────────────────
  HOUST:                { title: 'Housing Starts',                            unit: 'Thousands', category: 'real-estate' },
  MORTGAGE30US:         { title: '30-Year Fixed Rate Mortgage Average',       unit: '%',       category: 'real-estate' },

  // ─── Sentiment (FRED API) ──────────────────────────────
  UMCSENT:              { title: 'University of Michigan Consumer Sentiment', unit: 'Index',   category: 'sentiment' },

  // ─── Monetary (FRED API) ───────────────────────────────
  M2SL:                 { title: 'M2 Money Stock',                            unit: '$B',      category: 'monetary' },

  // ─── Cross-Market (FRED API) ───────────────────────────
  DTWEXBGS:             { title: 'Trade Weighted U.S. Dollar Index',          unit: 'Index',   category: 'cross-market' },
  DCOILWTICO:           { title: 'WTI Crude Oil Price',                       unit: '$/bbl',   category: 'cross-market' },
  GOLDAMGBD228NLBM:     { title: 'Gold Price (London Fix)',                   unit: '$/oz',    category: 'cross-market' },
  SP500:                { title: 'S&P 500 Index',                             unit: 'Index',   category: 'cross-market' },
  VIXCLS:               { title: 'CBOE Volatility Index (VIX)',               unit: 'Index',   category: 'cross-market' },
}

// ─── Free source coverage ─────────────────────────────────

// Treasury CSV columns → FRED series IDs
const TREASURY_COLUMNS: Record<string, string> = {
  '2 Yr': 'DGS2',
  '3 Yr': 'DGS3',
  '5 Yr': 'DGS5',
  '7 Yr': 'DGS7',
  '10 Yr': 'DGS10',
  '20 Yr': 'DGS20',
  '30 Yr': 'DGS30',
}

// Yield series served by Treasury CSV (free, no key)
const TREASURY_SERIES = new Set(['DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30', 'T10Y2Y'])

// World Bank indicator mappings (free, no key)
const WORLD_BANK_INDICATORS: Record<string, { indicator: string; transform: (val: number) => string }> = {
  GDP:      { indicator: 'NY.GDP.MKTP.CD', transform: (v) => (v / 1e9).toFixed(1) },
  CPIAUCSL: { indicator: 'FP.CPI.TOTL',    transform: (v) => v.toFixed(2) },
  UNRATE:   { indicator: 'SL.UEM.TOTL.ZS', transform: (v) => v.toFixed(1) },
}

// Series covered by free sources (no FRED API call needed)
const FREE_SERIES = new Set([...TREASURY_SERIES, ...Object.keys(WORLD_BANK_INDICATORS)])

// ─── Cache ────────────────────────────────────────────────

interface CacheEntry {
  data: FredSeries
  timestamp: number
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes
const seriesCache = new Map<string, CacheEntry>()

// ─── Treasury CSV Parser ─────────────────────────────────

interface TreasuryRow {
  date: string
  columns: Record<string, string>
}

function parseTreasuryCsv(text: string): TreasuryRow[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0])
  const dateIdx = headers.findIndex(h => h.toLowerCase() === 'date')
  if (dateIdx === -1) return []

  const rows: TreasuryRow[] = []
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = parseCsvLine(lines[i])
    const dateVal = cols[dateIdx]
    if (!dateVal) continue

    const columns: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      if (j !== dateIdx && cols[j] && cols[j] !== '.') {
        columns[headers[j]] = cols[j]
      }
    }
    rows.push({ date: normalizeTreasuryDate(dateVal), columns })
  }

  return rows
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function normalizeTreasuryDate(dateStr: string): string {
  const parts = dateStr.split('/')
  if (parts.length === 3) {
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
  }
  return dateStr
}

let treasuryCache: { rows: TreasuryRow[]; timestamp: number } | null = null
const TREASURY_CACHE_TTL = 30 * 60 * 1000

async function fetchTreasuryCsv(): Promise<TreasuryRow[]> {
  if (treasuryCache && Date.now() - treasuryCache.timestamp <= TREASURY_CACHE_TTL) {
    return treasuryCache.rows
  }

  const res = await fetch(TREASURY_CSV_URL, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Treasury CSV HTTP ${res.status}`)

  const text = await res.text()
  const rows = parseTreasuryCsv(text)

  treasuryCache = { rows, timestamp: Date.now() }
  return rows
}

function fetchFromTreasury(
  seriesId: string,
  rows: TreasuryRow[],
  limit: number,
): FredObservation[] {
  if (rows.length === 0) return []

  if (seriesId === 'T10Y2Y') {
    const dgs10Col = Object.keys(TREASURY_COLUMNS).find(k => TREASURY_COLUMNS[k] === 'DGS10')
    const dgs2Col = Object.keys(TREASURY_COLUMNS).find(k => TREASURY_COLUMNS[k] === 'DGS2')
    if (!dgs10Col || !dgs2Col) return []

    const observations: FredObservation[] = []
    for (const row of rows) {
      const d10 = row.columns[dgs10Col]
      const d2 = row.columns[dgs2Col]
      if (d10 && d2) {
        const spread = (Number.parseFloat(d10) - Number.parseFloat(d2)).toFixed(2)
        observations.push({ date: row.date, value: spread })
      }
      if (observations.length >= limit) break
    }
    return observations
  }

  const treasuryCol = Object.keys(TREASURY_COLUMNS).find(k => TREASURY_COLUMNS[k] === seriesId)
  if (!treasuryCol) return []

  const observations: FredObservation[] = []
  for (const row of rows) {
    const val = row.columns[treasuryCol]
    if (val) {
      observations.push({ date: row.date, value: val })
    }
    if (observations.length >= limit) break
  }
  return observations
}

// ─── FRED API type guards ─────────────────────────────────

function isFredObservations(value: unknown): value is Array<{ date: string; value: string }> {
  if (!Array.isArray(value)) return false
  return value.every(item =>
    item &&
    typeof item === 'object' &&
    'date' in item &&
    typeof (item as Record<string, unknown>).date === 'string' &&
    'value' in item &&
    typeof (item as Record<string, unknown>).value === 'string'
  )
}

function isFredResponse(value: unknown): value is { observations: Array<{ date: string; value: string }> } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'observations' in value &&
    isFredObservations((value as Record<string, unknown>).observations)
  )
}

// ─── World Bank fetcher ───────────────────────────────────

interface WorldBankObservation {
  date: string
  value: number | null
}

function isWorldBankResponse(json: unknown): json is [unknown, WorldBankObservation[]] {
  return Array.isArray(json) && json.length === 2 && Array.isArray(json[1])
}

async function fetchFromWorldBank(
  seriesId: string,
  mapping: { indicator: string; transform: (val: number) => string },
  limit: number,
): Promise<FredObservation[]> {
  const url = `${WORLD_BANK_BASE}/country/us/indicator/${mapping.indicator}?format=json&per_page=${Math.max(limit * 2, 20)}`

  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) throw new Error(`World Bank API ${res.status} for ${seriesId}`)

  const json: unknown = await res.json()
  if (!isWorldBankResponse(json)) throw new Error(`Unexpected World Bank response for ${seriesId}`)

  return json[1]
    .filter((obs) => obs.value !== null)
    .slice(0, limit)
    .map((obs) => ({
      date: obs.date,
      value: mapping.transform(obs.value as number),
    }))
}

// ─── FRED API fetcher ─────────────────────────────────────

async function fetchFromFredApi(
  seriesId: string,
  limit: number,
): Promise<FredObservation[] | null> {
  if (!FRED_API_KEY) return null

  const url = `${FRED_API_BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) return null

  const raw: unknown = await res.json()
  if (!isFredResponse(raw)) return null

  const observations: FredObservation[] = raw.observations
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: o.value }))

  return observations.length > 0 ? observations : null
}

// ─── Client ───────────────────────────────────────────────

/**
 * Fetch observations for a macro-economic series.
 * Priority: free sources first (Treasury CSV, World Bank), then FRED API.
 * This conserves FRED API rate limits for series that need it.
 *
 * @param seriesId — e.g. "FEDFUNDS", "GDP"
 * @param limit — max observations to return (most recent first, default 10)
 */
export async function getFredSeries(seriesId: string, limit = 10): Promise<FredSeries> {
  // Check cache
  const cached = seriesCache.get(seriesId)
  if (cached && Date.now() - cached.timestamp <= CACHE_TTL_MS) {
    return { ...cached.data, observations: cached.data.observations.slice(0, limit) }
  }

  const meta = FRED_SERIES[seriesId]
  const title = meta?.title ?? seriesId

  // 1. Treasury CSV for yield curve series (free, no key, daily updates)
  if (TREASURY_SERIES.has(seriesId)) {
    try {
      const rows = await fetchTreasuryCsv()
      const observations = fetchFromTreasury(seriesId, rows, limit)
      if (observations.length > 0) {
        const series: FredSeries = { id: seriesId, title, observations }
        seriesCache.set(seriesId, { data: series, timestamp: Date.now() })
        return series
      }
    } catch {
      // Silently fall through
    }
  }

  // 2. World Bank for GDP/CPI/Unemployment (free, no key, annual data)
  const wbMapping = WORLD_BANK_INDICATORS[seriesId]
  if (wbMapping) {
    try {
      const observations = await fetchFromWorldBank(seriesId, wbMapping, limit)
      if (observations.length > 0) {
        const series: FredSeries = { id: seriesId, title, observations }
        seriesCache.set(seriesId, { data: series, timestamp: Date.now() })
        return series
      }
    } catch {
      // Silently fall through
    }
  }

  // 3. FRED API for remaining series (requires FRED_API_KEY env var)
  if (!FREE_SERIES.has(seriesId)) {
    try {
      const fredObs = await fetchFromFredApi(seriesId, limit)
      if (fredObs) {
        const series: FredSeries = { id: seriesId, title, observations: fredObs }
        seriesCache.set(seriesId, { data: series, timestamp: Date.now() })
        return series
      }
    } catch {
      // Silently fall through
    }
  }

  // 4. FRED API fallback for free-source series if they returned empty
  if (FREE_SERIES.has(seriesId) && FRED_API_KEY) {
    try {
      const fredObs = await fetchFromFredApi(seriesId, limit)
      if (fredObs) {
        const series: FredSeries = { id: seriesId, title, observations: fredObs }
        seriesCache.set(seriesId, { data: series, timestamp: Date.now() })
        return series
      }
    } catch {
      // Silently fall through
    }
  }

  // 5. No data available — return empty series
  const empty: FredSeries = { id: seriesId, title, observations: [] }
  seriesCache.set(seriesId, { data: empty, timestamp: Date.now() })
  return empty
}

/**
 * Get the most recent observation for a series.
 * Returns null if no data is available.
 */
export async function getLatestObservation(seriesId: string): Promise<FredObservation | null> {
  const series = await getFredSeries(seriesId, 1)
  return series.observations[0] ?? null
}
