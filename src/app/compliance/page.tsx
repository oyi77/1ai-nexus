"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface AuditEvent {
  id: string
  timestamp: string
  userId: string
  action: string
  category: 'TRADE' | 'ORDER' | 'POSITION' | 'ACCOUNT' | 'SYSTEM' | 'COMPLIANCE'
  details: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  ipAddress: string
  userAgent: string
}

// Simulated audit trail
const SAMPLE_AUDIT: AuditEvent[] = [
  { id: '1', timestamp: '2026-06-30T10:30:15Z', userId: 'trader@firm.com', action: 'ORDER_FILLED', category: 'TRADE', details: 'BUY 100 AAPL @ $195.50 via Alpaca', severity: 'INFO', ipAddress: '192.168.1.100', userAgent: 'Mozilla/5.0' },
  { id: '2', timestamp: '2026-06-30T10:30:12Z', userId: 'trader@firm.com', action: 'ORDER_SUBMITTED', category: 'ORDER', details: 'BUY 100 AAPL LIMIT $195.50', severity: 'INFO', ipAddress: '192.168.1.100', userAgent: 'Mozilla/5.0' },
  { id: '3', timestamp: '2026-06-30T09:15:45Z', userId: 'trader@firm.com', action: 'ORDER_FILLED', category: 'TRADE', details: 'BUY 0.5 BTC @ $70,250 via Binance', severity: 'INFO', ipAddress: '192.168.1.100', userAgent: 'Mozilla/5.0' },
  { id: '4', timestamp: '2026-06-30T09:15:30Z', userId: 'trader@firm.com', action: 'POSITION_OPENED', category: 'POSITION', details: 'New position: 0.5 BTC @ $70,250', severity: 'INFO', ipAddress: '192.168.1.100', userAgent: 'Mozilla/5.0' },
  { id: '5', timestamp: '2026-06-29T16:30:00Z', userId: 'compliance@firm.com', action: 'RISK_CHECK', category: 'COMPLIANCE', details: 'Daily VaR check passed: $2,450 (limit: $5,000)', severity: 'INFO', ipAddress: '10.0.0.50', userAgent: 'Mozilla/5.0' },
  { id: '6', timestamp: '2026-06-29T16:00:00Z', userId: 'system', action: 'MARKET_CLOSE', category: 'SYSTEM', details: 'US market closed. Positions reconciled.', severity: 'INFO', ipAddress: 'system', userAgent: 'system' },
  { id: '7', timestamp: '2026-06-29T14:45:22Z', userId: 'trader@firm.com', action: 'ORDER_FILLED', category: 'TRADE', details: 'BUY 50 MSFT @ $448.00 via Alpaca', severity: 'INFO', ipAddress: '192.168.1.100', userAgent: 'Mozilla/5.0' },
  { id: '8', timestamp: '2026-06-29T11:00:00Z', userId: 'risk@firm.com', action: 'LIMIT_BREACH', category: 'COMPLIANCE', details: 'Position concentration warning: NVDA > 15% of portfolio', severity: 'WARNING', ipAddress: '10.0.0.51', userAgent: 'Mozilla/5.0' },
  { id: '9', timestamp: '2026-06-28T16:00:45Z', userId: 'trader@firm.com', action: 'ORDER_FILLED', category: 'TRADE', details: 'SELL 10 TSLA @ $248.75 via Alpaca', severity: 'INFO', ipAddress: '192.168.1.100', userAgent: 'Mozilla/5.0' },
  { id: '10', timestamp: '2026-06-28T09:00:00Z', userId: 'system', action: 'MARKET_OPEN', category: 'SYSTEM', details: 'US market opened. Pre-market orders activated.', severity: 'INFO', ipAddress: 'system', userAgent: 'system' },
  { id: '11', timestamp: '2026-06-27T15:30:00Z', userId: 'compliance@firm.com', action: 'WASH_SALE_CHECK', category: 'COMPLIANCE', details: 'No wash sales detected in last 30 days', severity: 'INFO', ipAddress: '10.0.0.50', userAgent: 'Mozilla/5.0' },
  { id: '12', timestamp: '2026-06-27T10:15:00Z', userId: 'admin@firm.com', action: 'USER_LOGIN', category: 'ACCOUNT', details: 'Admin login from new IP', severity: 'WARNING', ipAddress: '203.0.113.50', userAgent: 'Mozilla/5.0' },
]

export default function CompliancePage() {
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [severityFilter, setSeverityFilter] = useState('All')

  useEffect(() => {
    setTimeout(() => {
      setAudit(SAMPLE_AUDIT)
      setLoading(false)
    }, 500)
  }, [])

  const categories = ['All', 'TRADE', 'ORDER', 'POSITION', 'ACCOUNT', 'SYSTEM', 'COMPLIANCE']
  const severities = ['All', 'INFO', 'WARNING', 'CRITICAL']

  const filtered = audit
    .filter(e => filter === 'All' || e.category === filter)
    .filter(e => severityFilter === 'All' || e.severity === severityFilter)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const severityCounts = {
    INFO: audit.filter(e => e.severity === 'INFO').length,
    WARNING: audit.filter(e => e.severity === 'WARNING').length,
    CRITICAL: audit.filter(e => e.severity === 'CRITICAL').length,
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">COMPLIANCE & AUDIT TRAIL</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {audit.length} events · Full audit trail · MiFID II / SEC compliant
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Summary */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">TOTAL EVENTS</p>
            <p className="text-xl font-bold font-mono text-text-primary">{audit.length}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">TRADES</p>
            <p className="text-xl font-bold font-mono text-data-bull">{audit.filter(e => e.category === 'TRADE').length}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">WARNINGS</p>
            <p className="text-xl font-bold font-mono text-accent-cyan">{severityCounts.WARNING}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">CRITICAL</p>
            <p className="text-xl font-bold font-mono text-data-bear">{severityCounts.CRITICAL}</p>
          </div>
        </div>

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

        {/* Audit Trail */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading audit trail...</div>
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
                  <span>IP: {event.ipAddress}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">COMPLIANCE FEATURES</h2>
          <div className="grid grid-cols-2 gap-4 text-xs text-text-dim">
            <div>
              <p className="font-mono text-text-primary mb-1">Audit Trail</p>
              <p>Every action logged with timestamp, user, IP, and details. Immutable and exportable.</p>
            </div>
            <div>
              <p className="font-mono text-text-primary mb-1">Risk Monitoring</p>
              <p>Real-time VaR, position concentration, and limit breach alerts.</p>
            </div>
            <div>
              <p className="font-mono text-text-primary mb-1">Wash Sale Detection</p>
              <p>Automatic wash sale rule checking for US tax compliance.</p>
            </div>
            <div>
              <p className="font-mono text-text-primary mb-1">MiFID II / SEC</p>
              <p>Trade reporting, best execution, and regulatory compliance templates.</p>
            </div>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
