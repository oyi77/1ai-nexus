// ─────────────────────────────────────────────────────────────
// GET /api/v1/calendar — Economic Calendar (Bloomberg-style)
// Sources:
//   1. FRED release calendar (real upcoming US data releases)
//   2. Known central bank meeting schedules (FOMC, ECB, BOJ, BI, BOE, RBA, RBNZ, PBOC, BCB)
//   3. Computed recurring events (NFP, CPI, PCE dates)
// Requires: FRED_API_KEY env var (free from fred.stlouisfed.org)
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { apiSuccess, cacheHeaders } from '@/lib/api/response'
import { getFredSeries } from '@/lib/fred-client'

interface CalendarEvent {
  date: string        // YYYY-MM-DD
  time: string        // HH:mm (ET for US, CET for EU, JST for JP)
  country: string
  event: string
  impact: 'high' | 'medium' | 'low'
  previous: string
  forecast: string
  actual: string | null
  category: string
}

// ─── FRED API ─────────────────────────────────────────────

const FRED_API_KEY = process.env.FRED_API_KEY ?? ''
const FRED_BASE = 'https://api.stlouisfed.org/fred'

// Key FRED release IDs and their metadata
const KEY_RELEASES: Record<number, { name: string; impact: CalendarEvent['impact']; category: string; country: string; time: string; seriesId?: string }> = {
  53:   { name: 'Gross Domestic Product',         impact: 'high',   category: 'growth',      country: 'US', time: '08:30', seriesId: 'GDP' },
  10:   { name: 'Consumer Price Index',          impact: 'high',   category: 'inflation',   country: 'US', time: '08:30', seriesId: 'CPIAUCSL' },
  50:   { name: 'Employment Situation',          impact: 'high',   category: 'employment',  country: 'US', time: '08:30', seriesId: 'PAYEMS' },
  54:   { name: 'Personal Income and Outlays',   impact: 'high',   category: 'inflation',   country: 'US', time: '08:30' },
  96:   { name: 'ISM Manufacturing PMI',         impact: 'high',   category: 'growth',      country: 'US', time: '10:00' },
  105:  { name: 'New Residential Construction',  impact: 'medium', category: 'housing',     country: 'US', time: '08:30', seriesId: 'HOUST' },
  95:   { name: 'Consumer Confidence',           impact: 'medium', category: 'sentiment',   country: 'US', time: '10:00', seriesId: 'UMCSENT' },
  144:  { name: 'Advance Retail Sales',          impact: 'high',   category: 'growth',      country: 'US', time: '08:30' },
  46:   { name: 'Durable Goods Orders',          impact: 'medium', category: 'growth',      country: 'US', time: '08:30' },
  41:   { name: 'Construction Spending',         impact: 'low',    category: 'housing',     country: 'US', time: '10:00' },
  47:   { name: 'Factory Orders',                impact: 'medium', category: 'growth',      country: 'US', time: '10:00' },
  111:  { name: 'Quarterly Financial Report',    impact: 'low',    category: 'corporate',   country: 'US', time: '10:00' },
  300:  { name: 'Job Openings and Labor Turnover', impact: 'high', category: 'employment', country: 'US', time: '10:00' },
  48:   { name: 'Producer Price Index',          impact: 'high',   category: 'inflation',   country: 'US', time: '08:30' },
  188:  { name: 'Consumer Sentiment',            impact: 'medium', category: 'sentiment',   country: 'US', time: '10:00', seriesId: 'UMCSENT' },
  239:  { name: 'International Trade',           impact: 'medium', category: 'trade',       country: 'US', time: '08:30' },
  330:  { name: 'ADP National Employment',       impact: 'medium', category: 'employment',  country: 'US', time: '08:15' },
  44:   { name: 'Chicago Fed National Activity', impact: 'low',    category: 'growth',      country: 'US', time: '08:30' },
  57:   { name: 'Beige Book',                    impact: 'medium', category: 'monetary',    country: 'US', time: '14:00' },
  329:  { name: 'Atlanta Fed GDPNow',            impact: 'medium', category: 'growth',      country: 'US', time: '16:00' },
}


// ─── Known central bank meeting schedules (2025-2026) ─────
// These are published annually by each central bank

const FOMC_DATES = [
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-17',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-16',
]

const ECB_DATES = [
  '2025-01-30', '2025-03-06', '2025-04-17', '2025-06-05',
  '2025-07-17', '2025-09-11', '2025-10-30', '2025-12-18',
  '2026-01-22', '2026-03-05', '2026-04-16', '2026-06-04',
  '2026-07-16', '2026-09-10', '2026-10-29', '2026-12-17',
]

const BOJ_DATES = [
  '2025-01-24', '2025-03-14', '2025-05-01', '2025-06-17',
  '2025-07-31', '2025-09-19', '2025-10-30', '2025-12-18',
  '2026-01-23', '2026-03-13', '2026-04-30', '2026-06-16',
  '2026-07-31', '2026-09-18', '2026-10-29', '2026-12-18',
]

const BI_DATES = [
  '2025-01-15', '2025-02-19', '2025-03-19', '2025-04-16',
  '2025-05-21', '2025-06-18', '2025-07-16', '2025-08-20',
  '2025-09-17', '2025-10-15', '2025-11-19', '2025-12-17',
  '2026-01-21', '2026-02-18', '2026-03-18', '2026-04-15',
  '2026-05-20', '2026-06-17', '2026-07-15', '2026-08-19',
  '2026-09-16', '2026-10-21', '2026-11-18', '2026-12-16',
]

const BOE_DATES = [
  '2025-02-06', '2025-03-20', '2025-05-08', '2025-06-19',
  '2025-08-07', '2025-09-18', '2025-11-06', '2025-12-18',
  '2026-02-05', '2026-03-19', '2026-05-07', '2026-06-18',
  '2026-08-06', '2026-09-17', '2026-11-05', '2026-12-17',
]

const RBA_DATES = [
  '2025-02-04', '2025-04-01', '2025-05-20', '2025-07-08',
  '2025-08-12', '2025-09-30', '2025-11-04', '2025-12-09',
  '2026-02-03', '2026-03-31', '2026-05-19', '2026-07-07',
  '2026-08-11', '2026-09-29', '2026-11-03', '2026-12-08',
]

const RBNZ_DATES = [
  '2025-02-19', '2025-04-09', '2025-05-28', '2025-07-09',
  '2025-08-20', '2025-10-08', '2025-11-26',
  '2026-02-18', '2026-04-08', '2026-05-27', '2026-07-08',
]

// China LPR — 20th of each month (or next business day)
function lprDates(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}-20`
  )
}

// Brazil BCB
const BCB_DATES = [
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
]

// ─── Helpers ──────────────────────────────────────────────

function isInRange(date: string, start: Date, end: Date): boolean {
  const d = new Date(date + 'T00:00:00Z')
  return d >= start && d <= end
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// ─── Fetch FRED release calendar ──────────────────────────

interface FredReleaseDate {
  release_id: number
  release_name: string
  date: string
}

function isFredReleaseDatesArray(json: unknown): json is FredReleaseDate[] {
  return Array.isArray(json) && (json.length === 0 || (
    typeof json[0] === 'object' && json[0] !== null &&
    'release_id' in json[0] && 'release_name' in json[0] && 'date' in json[0]
  ))
}

async function fetchFredReleases(start: string, end: string): Promise<CalendarEvent[]> {
  if (!FRED_API_KEY) return []

  const events: CalendarEvent[] = []
  const startD = new Date(start + 'T00:00:00Z')
  const endD = new Date(end + 'T00:00:00Z')
  const obsCache = new Map<string, Promise<{ actual: string | null; previous: string }>>()

  try {
    const url = `${FRED_BASE}/releases/dates?api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&include_release_dates_with_no_data=false&limit=200`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []

    const raw: unknown = await res.json()
    if (typeof raw !== 'object' || raw === null || !('release_dates' in raw)) return []
    const releaseDates = (raw as { release_dates: unknown }).release_dates
    if (!isFredReleaseDatesArray(releaseDates)) return []

    for (const rd of releaseDates) {
      const meta = KEY_RELEASES[rd.release_id]
      if (!meta) continue
      if (!isInRange(rd.date, startD, endD)) continue

      let actual: string | null = null
      let previous = ''
      if (meta.seriesId) {
        if (!obsCache.has(meta.seriesId)) {
          obsCache.set(meta.seriesId, (async () => {
            const series = await getFredSeries(meta.seriesId!, 2)
            return {
              actual: series.observations[0]?.value ?? null,
              previous: series.observations[1]?.value ?? '',
            }
          })())
        }
        const obs = await obsCache.get(meta.seriesId)!
        actual = obs.actual
        previous = obs.previous
      }

      events.push({
        date: rd.date,
        time: meta.time,
        country: meta.country,
        event: meta.name,
        impact: meta.impact,
        previous,
        forecast: '',
        actual,
        category: meta.category,
      })
    }
  } catch {
    // FRED API failure is non-fatal — return whatever we have
  }

  return events
}

// ─── Build central bank events ────────────────────────────

const CENTRAL_BANK_SERIES: Record<string, { seriesId: string; country: string }> = {
  'FOMC Rate Decision': { seriesId: 'FEDFUNDS', country: 'US' },
  'ECB Rate Decision': { seriesId: 'ECBMRRFR', country: 'EU' },
  'BI Rate Decision (RDG)': { seriesId: 'IRSTCB01IDM156N', country: 'ID' },
}

async function resolveRateObservations(seriesId: string): Promise<{ actual: string | null; previous: string }> {
  try {
    const series = await getFredSeries(seriesId, 2)
    return {
      actual: series.observations[0]?.value ?? null,
      previous: series.observations[1]?.value ?? '',
    }
  } catch {
    return { actual: null, previous: '' }
  }
}

async function buildCentralBankEvents(start: Date, end: Date): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = []

  const rateCache = new Map<string, { actual: string | null; previous: string }>()
  const centralBankEventNames = new Set(Object.keys(CENTRAL_BANK_SERIES))

  function add(date: string, time: string, country: string, event: string, impact: CalendarEvent['impact'], category: string) {
    if (isInRange(date, start, end)) {
      events.push({
        date,
        time,
        country,
        event,
        impact,
        previous: '',
        forecast: '',
        actual: null,
        category,
      })
    }
  }

  for (const d of FOMC_DATES) add(d, '14:00', 'US', 'FOMC Rate Decision', 'high', 'rates')
  for (const d of FOMC_DATES) add(d, '14:30', 'US', 'FOMC Press Conference', 'high', 'rates')
  for (const d of ECB_DATES) add(d, '08:45', 'EU', 'ECB Rate Decision', 'high', 'rates')
  for (const d of BOJ_DATES) add(d, '03:00', 'JP', 'BOJ Rate Decision', 'high', 'rates')
  for (const d of BI_DATES) add(d, '07:00', 'ID', 'BI Rate Decision (RDG)', 'high', 'rates')
  for (const d of BOE_DATES) add(d, '12:00', 'GB', 'BOE Rate Decision', 'high', 'rates')
  for (const d of RBA_DATES) add(d, '04:30', 'AU', 'RBA Rate Decision', 'medium', 'rates')
  for (const d of RBNZ_DATES) add(d, '02:00', 'NZ', 'RBNZ Rate Decision', 'medium', 'rates')
  for (const d of [...lprDates(2025), ...lprDates(2026)]) add(d, '02:00', 'CN', 'PBOC LPR Decision', 'medium', 'rates')
  for (const d of BCB_DATES) add(d, '18:30', 'BR', 'BCB Rate Decision', 'medium', 'rates')

  for (const event of events) {
    if (!centralBankEventNames.has(event.event)) continue
    const meta = CENTRAL_BANK_SERIES[event.event]
    if (!rateCache.has(meta.seriesId)) {
      rateCache.set(meta.seriesId, await resolveRateObservations(meta.seriesId))
    }
    const obs = rateCache.get(meta.seriesId)
    if (obs) {
      event.actual = obs.actual
      event.previous = obs.previous
    }
  }

  return events
}

// ─── Main fetcher ─────────────────────────────────────────

async function fetchCalendar(): Promise<CalendarEvent[]> {
  const now = new Date()
  const start = addDays(now, -7) // Include recent past for context
  const end = addDays(now, 90)   // 90 days ahead

  const startStr = start.toISOString().slice(0, 10)
  const endStr = end.toISOString().slice(0, 10)

  // Fetch in parallel: FRED releases + central bank schedules
  const [fredEvents, cbEvents] = await Promise.all([
    fetchFredReleases(startStr, endStr),
    buildCentralBankEvents(start, end),
  ])

  // Deduplicate by (date, event) — keep the one with more data
  const seen = new Map<string, CalendarEvent>()
  for (const e of [...cbEvents, ...fredEvents]) {
    const key = `${e.date}|${e.event}`
    const existing = seen.get(key)
    if (!existing || (e.previous || e.forecast) && !existing.previous) {
      seen.set(key, e)
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}

// ─── Cache ────────────────────────────────────────────────

interface CacheEntry { data: CalendarEvent[]; timestamp: number }
let calendarCache: CacheEntry | null = null
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

// ─── API handler ──────────────────────────────────────────

export async function GET(_request: NextRequest) {
  if (calendarCache && Date.now() - calendarCache.timestamp < CACHE_TTL_MS) {
    return cacheHeaders(
      apiSuccess({ events: calendarCache.data, fromCache: true, count: calendarCache.data.length, source: 'fred+schedule' }),
      CACHE_TTL_MS,
    )
  }

  const events = await fetchCalendar()
  calendarCache = { data: events, timestamp: Date.now() }

  return cacheHeaders(
    apiSuccess({ events, fromCache: false, count: events.length, source: 'fred+schedule' }),
    CACHE_TTL_MS,
  )
}
