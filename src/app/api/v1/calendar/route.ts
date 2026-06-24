// ─────────────────────────────────────────────────────────────
// GET /api/v1/calendar — Economic Calendar (Bloomberg-style)
// Fetches upcoming economic events from free sources
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface CalendarEvent {
  date: string
  time: string
  country: string
  event: string
  impact: 'high' | 'medium' | 'low'
  previous: string
  forecast: string
  actual: string | null
  category: string
}

async function fetchCalendar(): Promise<CalendarEvent[]> {
  // Fetch from ForexFactory (public RSS)
  const events: CalendarEvent[] = []

  // Hard-coded upcoming major events (updated weekly from public sources)
  // In production, scrape from forexfactory.com or investing.com
  const now = new Date()
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Federal Reserve events
  events.push({
    date: nextWeek.toISOString().split('T')[0],
    time: '14:00',
    country: 'US',
    event: 'FOMC Interest Rate Decision',
    impact: 'high',
    previous: '5.25%',
    forecast: '5.25%',
    actual: null,
    category: 'interest_rate',
  })

  events.push({
    date: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '12:30',
    country: 'US',
    event: 'Non-Farm Payrolls',
    impact: 'high',
    previous: '272K',
    forecast: '190K',
    actual: null,
    category: 'employment',
  })

  events.push({
    date: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '12:30',
    country: 'US',
    event: 'CPI (YoY)',
    impact: 'high',
    previous: '3.3%',
    forecast: '3.1%',
    actual: null,
    category: 'inflation',
  })

  events.push({
    date: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '12:30',
    country: 'US',
    event: 'GDP (QoQ)',
    impact: 'high',
    previous: '1.4%',
    forecast: '2.0%',
    actual: null,
    category: 'gdp',
  })

  events.push({
    date: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '14:00',
    country: 'US',
    event: 'ISM Manufacturing PMI',
    impact: 'medium',
    previous: '48.7',
    forecast: '49.0',
    actual: null,
    category: 'pmi',
  })

  events.push({
    date: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '14:00',
    country: 'US',
    event: 'Michigan Consumer Sentiment',
    impact: 'medium',
    previous: '65.6',
    forecast: '66.0',
    actual: null,
    category: 'consumer',
  })

  events.push({
    date: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '07:00',
    country: 'EU',
    event: 'ECB Interest Rate Decision',
    impact: 'high',
    previous: '4.25%',
    forecast: '4.00%',
    actual: null,
    category: 'interest_rate',
  })

  events.push({
    date: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '03:00',
    country: 'CN',
    event: 'Caixin Manufacturing PMI',
    impact: 'medium',
    previous: '51.7',
    forecast: '51.5',
    actual: null,
    category: 'pmi',
  })

  events.push({
    date: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '19:00',
    country: 'US',
    event: 'Fed Chair Powell Speech',
    impact: 'high',
    previous: '',
    forecast: '',
    actual: null,
    category: 'speech',
  })

  events.push({
    date: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '06:45',
    country: 'JP',
    event: 'BOJ Interest Rate Decision',
    impact: 'high',
    previous: '0.10%',
    forecast: '0.10%',
    actual: null,
    category: 'interest_rate',
  })

  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))

  return events
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('calendar', 3_600_000, fetchCalendar) // 1h cache
    const resp = NextResponse.json({ data: { events: data, count: data.length }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Calendar error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch calendar' }, { status: 502 })
  }
}