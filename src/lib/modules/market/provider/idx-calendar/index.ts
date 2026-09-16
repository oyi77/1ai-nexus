// ─────────────────────────────────────────────────────────────
// Corporate calendar — live-only dividend/IPO event feed from the
// Stockbit exodus API (needs staged session; 503-safe when absent).
// No DB tables: events are point-in-time, harvester snapshots would
// rot. SERVER-ONLY. Consume via /api/v1/saham/calendar.
// Live-verified 2026-09-16 (BMRI ex-div rows with dividend_exdate).
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { sbGet } from '@/lib/modules/market/provider/idx-stockbit/client'
import { EmptySnapshotError } from '@/lib/modules/market/provider/idx-stockbit'
import { hasSessionCredentials } from '@/lib/modules/market/provider/idx-stockbit/session'

const CACHE_TTL = 30 * 60_000

export interface CalendarEvent {
  symbol: string
  kind: 'dividend' | 'bonus' | 'split' | 'rights' | 'other'
  exdate: string
  recordDate: string
  payDate: string
  value: string
}

export interface CalendarData {
  capturedAt: string
  dividends: CalendarEvent[]
}

function toEvent(r: Record<string, unknown>, kind: CalendarEvent['kind']): CalendarEvent | null {
  const symbol = typeof r.company_symbol === 'string' ? r.company_symbol : ''
  if (!symbol) return null
  const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
  return {
    symbol,
    kind,
    exdate: str(r.dividend_exdate ?? r.ex_date ?? r.exdate),
    recordDate: str(r.dividend_recdate ?? r.rec_date),
    payDate: str(r.dividend_paydate ?? r.pay_date),
    value: str(r.dividend_value ?? r.value),
  }
}

export async function getCalendar(): Promise<CalendarData> {
  if (!hasSessionCredentials()) throw new EmptySnapshotError('Stockbit session (calendar)')
  const { data } = await getCached('stockbit-calendar:v1', CACHE_TTL, async () => {
    const payload = await sbGet<{
      data?: { dividend?: Array<Record<string, unknown>>; bonus?: Array<Record<string, unknown>> }
    }>('/corpaction')
    const dividends: CalendarEvent[] = []
    for (const r of payload.data?.dividend ?? []) {
      const e = toEvent(r, 'dividend')
      if (e) dividends.push(e)
    }
    for (const r of payload.data?.bonus ?? []) {
      const e = toEvent(r, 'other')
      if (e) dividends.push(e)
    }
    return { capturedAt: new Date().toISOString(), dividends } as CalendarData
  })
  return data
}
