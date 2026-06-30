"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface AuditEvent {
  id: string
  timestamp: string
  userId: string
  action: string
  category: string
  details: string
  severity: string
  metadata?: Record<string, unknown>
}

interface AuditStats {
  total: number
  byCategory: Record<string, number>
  bySeverity: Record<string, number>
}

export default function CompliancePage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')
  const [severityFilter, setSeverityFilter] = useState('All')

  const fetchData = useCallback(async () => {
    try {
      const [logRes, statsRes] = await Promise.all([
        fetch('/api/v1/compliance?action=log&limit=100'),
        fetch('/api/v1/compliance?action=stats'),
      ])

      if (logRes.ok) {
        const logData = await logRes.json()
        setEvents(logData.data?.events ?? [])
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json()
        setStats(statsData.data)
      }

      setLoading(false)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [fetchData])

  const categories = ['All', 'TRADE', 'ORDER', 'POSITION', 'ACCOUNT', 'SYSTEM', 'COMPLIANCE', 'RISK']
  const severities = ['All', 'INFO', 'WARNING', 'CRITICAL']

  const filtered = events
    .filter(e => filter === 'All' || e.category === filter)
    .filter(e => severityFilter === 'All' || e.severity === severityFilter)

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">COMPLIANCE & AUDIT TRAIL</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {events.length} events · Real audit log · JSONL file + ring buffer
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
        </div>

        {error && (
          <div className="text-data-bear text-[11px] font-mono p-4 bg-bg-panel border border-border-dim rounded">
            Error: {error}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">TOTAL EVENTS</p>
              <p className="text-xl font-bold font-mono text-text-primary">{stats.total}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">TRADES</p>
              <p className="text-xl font-bold font-mono text-data-bull">{stats.byCategory?.TRADE ?? 0}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">WARNINGS</p>
              <p className="text-xl font-bold font-mono text-accent-cyan">{stats.bySeverity?.WARNING ?? 0}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">CRITICAL</p>
              <p className="text-xl font-bold font-mono text-data-bear">{stats.bySeverity?.CRITICAL ?? 0}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-text-muted font-mono">Category:</span>
          {categories.map(cat => (
            <button key={cat} onClick={() => setFilter(cat)}
              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                filter === cat
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {cat}
            </button>
          ))}
          <span className="text-[10px] text-text-muted font-mono ml-4">Severity:</span>
          {severities.map(sev => (
            <button key={sev} onClick={() => setSeverityFilter(sev)}
              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                severityFilter === sev
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {sev}
            </button>
          ))}
        </div>

        {/* Audit Events */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading audit trail...</div>
        ) : filtered.length === 0 ? (
          <div className="text-text-dim text-xs p-8 text-center">
            No audit events yet. Events are logged when trading actions occur.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(event => (
              <div key={event.id} className={`bg-bg-panel border rounded-lg p-3 ${
                event.severity === 'CRITICAL' ? 'border-data-bear' :
                event.severity === 'WARNING' ? 'border-accent-cyan' : 'border-border-dim'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      event.severity === 'CRITICAL' ? 'bg-data-bear/20 text-data-bear' :
                      event.severity === 'WARNING' ? 'bg-accent-cyan/20 text-accent-cyan' :
                      'bg-bg-elevated text-text-muted'
                    }`}>
                      {event.severity}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-elevated text-text-muted">
                      {event.category}
                    </span>
                    <span className="text-xs font-mono text-accent-cyan">{event.action}</span>
                  </div>
                  <span className="text-[9px] font-mono text-text-muted">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-text-dim">{event.details}</p>
                <div className="flex items-center gap-4 mt-1 text-[9px] font-mono text-text-muted">
                  <span>User: {event.userId}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">COMPLIANCE FEATURES</h2>
          <div className="grid grid-cols-2 gap-4 text-xs text-text-dim">
            <div>
              <p className="font-mono text-text-primary mb-1">Real Audit Trail</p>
              <p>Every action logged to JSONL file + in-memory ring buffer. Trade, order, position, and compliance events.</p>
            </div>
            <div>
              <p className="font-mono text-text-primary mb-1">File Persistence</p>
              <p>Events written to logs/audit.jsonl. Survives server restarts. Ring buffer (1000 events) for UI display.</p>
            </div>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
