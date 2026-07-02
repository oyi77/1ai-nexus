// ─────────────────────────────────────────────────────────────
// FRED Economic Calendar Provider
// Hours until next high-impact macro event (FOMC, NFP, CPI, etc.)
// Context signal: warns all markets about incoming volatility
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

// ─── Types ──────────────────────────────────────────────────

interface CalendarEvent {
  date: string        // YYYY-MM-DD
  time: string        // HH:mm (ET)
  event: string
  impact: 'high' | 'medium' | 'low'
}

interface FredReleaseDate {
  release_id: number
  release_name: string
  date: string
}

// ─── FRED Release Calendar ──────────────────────────────────

const FRED_API_KEY = process.env.FRED_API_KEY ?? ''
const FRED_BASE = 'https://api.stlouisfed.org/fred'

// Key FRED release IDs mapped to impact + metadata
const KEY_RELEASES: Record<number, { name: string; impact: CalendarEvent['impact']; time: string }> = {
  53:   { name: 'GDP',                     impact: 'high',   time: '08:30' },
  10:   { name: 'CPI',                     impact: 'high',   time: '08:30' },
  233:  { name: 'PCE Price Index',          impact: 'high',   time: '08:30' },
  46:   { name: 'Nonfarm Payrolls',         impact: 'high',   time: '08:30' },
  50:   { name: 'Unemployment Rate',        impact: 'high',   time: '08:30' },
  52:   { name: 'Retail Sales',             impact: 'high',   time: '08:30' },
  47:   { name: 'PPI',                     impact: 'high',   time: '08:30' },
  201:  { name: 'Durable Goods Orders',     impact: 'medium', time: '08:30' },
  211:  { name: 'ISM Manufacturing PMI',   impact: 'medium', time: '10:00' },
  15:   { name: 'CPI (YoY)',              impact: 'high',   time: '08:30' },
  234:  { name: 'Consumer Sentiment',      impact: 'medium', time: '10:00' },
  209:  { name: 'JOLTs Job Openings',      impact: 'medium', time: '10:00' },
}

// ─── Central Bank Meeting Schedules (2025-2026) ────────────

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

// ─── Calendar Helpers ───────────────────────────────────────

function buildCentralBankEvents(): CalendarEvent[] {
  const now = new Date()
  const nowStr = now.toISOString().slice(0, 10)
  const events: CalendarEvent[] = []

  const banks: Array<{ name: string; dates: string[]; time: string }> = [
    { name: 'FOMC', dates: FOMC_DATES, time: '14:00' },
    { name: 'ECB',  dates: ECB_DATES,  time: '08:15' },
    { name: 'BOJ',  dates: BOJ_DATES,  time: '00:00' },
    { name: 'BI',   dates: BI_DATES,   time: '07:00' },
    { name: 'BOE',  dates: BOE_DATES,  time: '07:00' },
    { name: 'RBA',  dates: RBA_DATES,  time: '04:30' },
  ]

  for (const bank of banks) {
    for (const date of bank.dates) {
      if (date >= nowStr) {
        events.push({
          date,
          time: bank.time,
          event: `${bank.name} Rate Decision`,
          impact: 'high',
        })
      }
    }
  }

  return events
}

function isFredReleaseDatesArray(json: unknown): json is FredReleaseDate[] {
  if (!Array.isArray(json)) return false
  return json.every(
    item =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as FredReleaseDate).release_id === 'number' &&
      typeof (item as FredReleaseDate).release_name === 'string' &&
      typeof (item as FredReleaseDate).date === 'string',
  )
}

async function fetchFredHighImpactEvents(): Promise<CalendarEvent[]> {
  if (!FRED_API_KEY) return []

  const nowStr = new Date().toISOString().slice(0, 10)
  try {
    const url =
      `${FRED_BASE}/releases/dates?api_key=${FRED_API_KEY}&file_type=json` +
      `&sort_order=asc&include_release_dates_with_no_data=false&limit=100`

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []

    const json: unknown = await res.json()
    if (!Array.isArray(json) || !isFredReleaseDatesArray(json)) return []

    return json
      .filter(r => r.date >= nowStr && KEY_RELEASES[r.release_id]?.impact === 'high')
      .map(r => {
        const meta = KEY_RELEASES[r.release_id]
        return {
          date: r.date,
          time: meta.time,
          event: meta.name,
          impact: 'high' as const,
        }
      })
  } catch {
    return []
  }
}

// ─── Core Provider Logic ────────────────────────────────────

interface CalendarResult {
  nextEvent: CalendarEvent | null
  hoursUntil: number
}

async function fetchNextHighImpactEvent(): Promise<CalendarResult> {
  const [fredEvents, cbEvents] = await Promise.all([
    fetchFredHighImpactEvents(),
    buildCentralBankEvents(),
  ])

  // Deduplicate
  const seen = new Map<string, CalendarEvent>()
  for (const e of [...cbEvents, ...fredEvents]) {
    const key = `${e.date}|${e.event}`
    if (!seen.has(key)) seen.set(key, e)
  }

  const allEvents = Array.from(seen.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))

  if (allEvents.length === 0) return { nextEvent: null, hoursUntil: 168 }

  const next = allEvents[0]
  const eventTime = new Date(`${next.date}T${next.time}:00-05:00`) // ET
  const hoursUntil = (eventTime.getTime() - Date.now()) / (1000 * 60 * 60)

  return {
    nextEvent: next,
    hoursUntil: Math.max(0, hoursUntil),
  }
}

// Normalize: 0 = event imminent, 100 = no event for 7+ days
// 168 hours = 7 days
const WEEK_HOURS = 168

function getHumanReadable(nextEvent: CalendarEvent | null, hoursUntil: number): string {
  if (!nextEvent || hoursUntil >= WEEK_HOURS) return 'No high-impact macro events this week — low volatility expected'

  const days = Math.ceil(hoursUntil / 24)
  const dayLabel = days <= 1 ? 'tomorrow' : `in ${days} days`
  const volatility = hoursUntil < 24 ? 'elevated volatility' : 'expect volatility'

  return `${nextEvent.event} ${dayLabel} — ${volatility}`
}

// ─── Provider ───────────────────────────────────────────────

class FredCalendarProvider implements MarketDataProvider {
  readonly id = 'fred-calendar'
  readonly tier = 'macro' as const
  readonly supportedMarkets: MarketVertical[] = [
    'crypto_cex', 'forex', 'idx_bonds', 'commodity', 'binary', 'deriv',
  ]

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(_symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: calendar } = await getCached('fred-calendar', config.ttlMs, fetchNextHighImpactEvent)

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: 'MACRO',
      market,
      rawValue: calendar.hoursUntil,
      normalizedScore: calendar.hoursUntil >= WEEK_HOURS ? 100 : Math.round((calendar.hoursUntil / WEEK_HOURS) * 100),
      direction: 'neutral', // Context signal, not directional
      confidence: 0.9,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(calendar.nextEvent, calendar.hoursUntil),
    }
  }
}

export const fredCalendarProvider = new FredCalendarProvider()
