"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

// ── Types matching the API response ──────────────────────

interface MevIndicator {
  type: string
  pair: string
  dex: string
  metric: string
  value: number
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  description: string
}

interface MevStats {
  totalIndicators: number
  highSeverity: number
  mediumSeverity: number
  byType: Record<string, number>
  pairsScanned: number
}

const TYPE_ICONS: Record<string, string> = {
  'Sandwich Suspect': '🥪',
  'Sell Pressure': '📉',
  'Bot Activity': '🤖',
}

const TYPE_COLORS: Record<string, string> = {
  'Sandwich Suspect': 'bg-data-bear/20 text-data-bear',
  'Sell Pressure': 'bg-accent-amber/20 text-accent-amber',
  'Bot Activity': 'bg-blue-500/20 text-blue-400',
}

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: 'text-data-bear',
  MEDIUM: 'text-accent-amber',
  LOW: 'text-text-muted',
}

export default function MevPage() {
  const [indicators, setIndicators] = useState<MevIndicator[]>([])
  const [stats, setStats] = useState<MevStats | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/mev')
      const d = await res.json()
      if (d.data) {
        setIndicators(d.data.indicators ?? [])
        setStats(d.data.stats ?? null)
        setUpdatedAt(d.data.timestamp ?? null)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
    const iv = setInterval(fetchData, 15_000)
    return () => clearInterval(iv)
  }, [fetchData])

  const hasError = status === 'error'
  const hasData = indicators.length > 0
  const byType = stats ? Object.entries(stats.byType).sort((a, b) => b[1] - a[1]) : []

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-data-bear">🛡</span> MEV Detector
            </h1>
            <p className="text-[12px] text-text-muted mt-1">
              Extractable-value indicators derived from live DEX pair activity — sandwich
              suspects, sell pressure, and automated-trading signatures.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-xs font-mono text-text-muted">
                {new Date(updatedAt).toLocaleTimeString()}
              </span>
            )}
            <LiveDot status={status} label />
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-2">
          <KPI
            label="Indicators"
            value={String(indicators.length)}
            color={indicators.length > 0 ? 'text-data-bear' : undefined}
          />
          <KPI
            label="High Severity"
            value={String(stats?.highSeverity ?? 0)}
            color={stats && stats.highSeverity > 0 ? 'text-data-bear' : undefined}
          />
          <KPI
            label="Medium Severity"
            value={String(stats?.mediumSeverity ?? 0)}
            color={stats && stats.mediumSeverity > 0 ? 'text-accent-amber' : undefined}
          />
          <KPI label="Pairs Scanned" value={String(stats?.pairsScanned ?? 0)} />
        </div>

        {/* Type breakdown */}
        {byType.length > 0 && (
          <Panel title="Indicator Types" subtitle="Breakdown by detected pattern" liveStatus={status}>
            <div className="p-3 grid grid-cols-4 gap-3">
              {byType.map(([name, count]) => (
                <div key={name} className="bg-bg-raised p-3 rounded border border-bg-border">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[14px]">{TYPE_ICONS[name] ?? '•'}</span>
                    <span className="text-xs font-mono text-text-muted uppercase truncate">{name}</span>
                  </div>
                  <div className="text-[20px] font-head font-bold text-text-primary tabular-nums">{count}</div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Detected indicators */}
        <Panel
          title="Detected MEV Indicators"
          subtitle={hasData ? `${indicators.length} flagged from live pair activity` : 'Derived from live DEX pair activity'}
          liveStatus={status}
          onRefresh={fetchData}
        >
          <div className="space-y-1 p-2">
            {hasError ? (
              <div className="p-8 text-center">
                <div className="text-[13px] text-text-primary mb-2">Connection error</div>
                <div className="text-xs text-text-muted font-mono">
                  Failed to reach the MEV detection service — will retry automatically
                </div>
              </div>
            ) : hasData ? (
              indicators.map((ind, i) => (
                <div
                  key={`${ind.pair}-${ind.type}-${i}`}
                  className="flex items-center gap-3 py-2 px-3 border-b border-bg-border/50 hover:bg-bg-raised transition-colors"
                >
                  <span className="text-[16px]">{TYPE_ICONS[ind.type] ?? '•'}</span>
                  <span
                    className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${TYPE_COLORS[ind.type] ?? 'bg-bg-raised text-text-muted'}`}
                  >
                    {ind.type.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-text-primary w-28 truncate" title={ind.pair}>
                    {ind.pair}
                  </span>
                  <span className="text-xs font-mono text-text-muted w-20 truncate">{ind.dex}</span>
                  <span className="text-xs font-mono text-text-muted hidden md:inline whitespace-nowrap">
                    {ind.metric}
                  </span>
                  <span className="text-xs font-mono text-text-primary tabular-nums">{ind.value}</span>
                  <span
                    className={`text-xs font-mono px-1.5 py-0.5 rounded bg-bg-raised ${SEVERITY_COLORS[ind.severity] ?? 'text-text-muted'}`}
                  >
                    {ind.severity}
                  </span>
                  <span
                    className="text-xs text-text-muted flex-1 truncate hidden lg:inline"
                    title={ind.description}
                  >
                    {ind.description}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <div className="text-[13px] text-text-primary mb-2">No MEV activity detected</div>
                <div className="text-xs text-text-muted font-mono max-w-xl mx-auto">
                  No pair currently exceeds the detection thresholds — volume/liquidity above 5x
                  with a &gt;20% price swing, a sell/buy ratio above 3, or high volume on thin
                  liquidity. {stats ? `${stats.pairsScanned} pairs scanned.` : ''}
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}

// ── Sub-components ───────────────────────────────────────

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-xs text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}
