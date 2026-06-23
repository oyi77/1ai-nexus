"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

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

const impactColors: Record<string, string> = {
  high: 'bg-data-bear/20 text-data-bear',
  medium: 'bg-accent-amber/20 text-accent-amber',
  low: 'bg-bg-raised text-text-muted',
}

const countryFlags: Record<string, string> = {
  US: '🇺🇸',
  EU: '🇪🇺',
  CN: '🇨🇳',
  JP: '🇯🇵',
  GB: '🇬🇧',
  DE: '🇩🇪',
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/calendar')
      const d = await res.json()
      if (d.success && d.data?.events) {
        setEvents(d.data.events)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 3_600_000) // 1h refresh
    return () => clearInterval(id)
  }, [fetchData])

  const filtered = filter === 'all' ? events : events.filter(e => e.impact === filter)

  const grouped = filtered.reduce((acc, event) => {
    if (!acc[event.date]) acc[event.date] = []
    acc[event.date].push(event)
    return acc
  }, {} as Record<string, CalendarEvent[]>)

  const highImpact = events.filter(e => e.impact === 'high').length
  const nextEvent = events.find(e => e.actual === null)

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">📅</span> Economic Calendar
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Upcoming macro events from Federal Reserve, ECB, BOJ, and major economic indicators.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-2">
          <KPI label="Total Events" value={String(events.length)} />
          <KPI label="High Impact" value={String(highImpact)} color="text-data-bear" />
          <KPI label="Next Event" value={nextEvent ? `${nextEvent.event} (${nextEvent.date})` : '—'} />
          <KPI label="Countries" value={String(new Set(events.map(e => e.country)).size)} />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-text-muted uppercase">Impact:</span>
          <div className="flex bg-bg-raised p-1 rounded">
            {(['all', 'high', 'medium', 'low'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-mono rounded uppercase transition-colors ${filter === f ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Calendar */}
        {Object.entries(grouped).map(([date, dayEvents]) => (
          <Panel key={date} title={formatDate(date)} subtitle={`${dayEvents.length} events`}>
            <div className="p-3 space-y-1">
              {dayEvents.map((event, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-bg-border/50 last:border-0">
                  {/* Time */}
                  <span className="text-[11px] font-mono text-text-muted w-14 tabular-nums">{event.time}</span>

                  {/* Country */}
                  <span className="text-[14px] w-6">{countryFlags[event.country] ?? event.country}</span>

                  {/* Impact */}
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded w-14 text-center ${impactColors[event.impact]}`}>
                    {event.impact.toUpperCase()}
                  </span>

                  {/* Event Name */}
                  <span className="flex-1 text-[12px] font-mono text-text-primary font-medium">{event.event}</span>

                  {/* Data Columns */}
                  <div className="flex items-center gap-4">
                    <div className="text-right w-16">
                      <div className="text-[9px] font-mono text-text-muted">Previous</div>
                      <div className="text-[11px] font-mono text-text-primary tabular-nums">{event.previous || '—'}</div>
                    </div>
                    <div className="text-right w-16">
                      <div className="text-[9px] font-mono text-text-muted">Forecast</div>
                      <div className="text-[11px] font-mono text-text-primary tabular-nums">{event.forecast || '—'}</div>
                    </div>
                    <div className="text-right w-16">
                      <div className="text-[9px] font-mono text-text-muted">Actual</div>
                      <div className={`text-[11px] font-mono font-bold tabular-nums ${event.actual ? 'text-teal-vivid' : 'text-text-muted'}`}>
                        {event.actual ?? '—'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-text-muted text-[12px] font-mono p-8">No events matching filter</div>
        )}
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[14px] font-head font-bold tabular-nums truncate ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'

  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}