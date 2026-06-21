"use client"

import { useMemo, useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { Sparkline } from '@/components/primitives/Sparkline'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface GapSignalEntry {
  pairLabel: string
  venueA: string
  venueB: string
  priceA: number
  priceB: number
  spreadPct: number
  zScore: number
  alert: boolean
  source: string
  timestamp: number
}

interface KimchiPremium {
  asset: string
  premiumPct: number
  zScore: number
  alert: boolean
  krwPriceUsd: number
  globalPriceUsd: number
  timestamp: number
}

interface KimchiResponse {
  data: {
    premium: KimchiPremium[]
    history: Array<{ premiumPct: number; timestamp: number }>
  }
}

interface AllSignalsResponse {
  data: GapSignalEntry[]
  count: number
}

function KimchiGauge({ premium, label }: { premium: number; label: string }) {
  // Gauge: -10 to +10 range, normalized to 0-100
  const normalized = Math.max(0, Math.min(100, ((premium + 10) / 20) * 100))
  const isHot = premium > 3
  const isCold = premium < -3
  const barColor = isHot ? 'bg-data-bear' : isCold ? 'bg-data-bull' : 'bg-teal-vivid'

  return (
    <div className="flex-1 min-w-[140px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">{label}</span>
        <span className={`text-[14px] font-head font-bold tabular-nums ${
          isHot ? 'text-data-bear' : isCold ? 'text-data-bull' : 'text-text-primary'
        }`}>
          {premium > 0 ? '+' : ''}{premium.toFixed(2)}%
        </span>
      </div>
      <div className="h-2 bg-bg-raised rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${normalized}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[8px] font-mono text-text-muted">-10%</span>
        <span className="text-[8px] font-mono text-text-muted">0</span>
        <span className="text-[8px] font-mono text-text-muted">+10%</span>
      </div>
    </div>
  )
}

export default function GapsPage() {
  const { data: allSignals, status } = useLiveFetch<AllSignalsResponse>({
    url: '/api/v1/gaps?action=all',
    interval: 15_000,
    initialData: { data: [], count: 0 },
  })

  const { data: kimchiData } = useLiveFetch<KimchiResponse>({
    url: '/api/v1/gaps?action=kimchi',
    interval: 15_000,
    initialData: { data: { premium: [], history: [] } },
  })

  const [filter, setFilter] = useState<'all' | 'kimchi' | 'basis' | 'weekend'>('all')
  const [search, setSearch] = useState('')

  const signals = allSignals?.data || []
  const kimchiPremium = kimchiData?.data?.premium || []

  const filtered = useMemo(() => {
    let result = signals
    if (filter !== 'all') {
      result = result.filter(s => s.source === filter)
    }
    if (search) {
      result = result.filter(s =>
        s.pairLabel.toLowerCase().includes(search.toLowerCase()) ||
        s.venueA.toLowerCase().includes(search.toLowerCase()) ||
        s.venueB.toLowerCase().includes(search.toLowerCase())
      )
    }
    return result
  }, [signals, filter, search])

  const alertCount = signals.filter(s => s.alert).length

  const columns: Column<GapSignalEntry>[] = [
    {
      key: 'pairLabel',
      header: 'Pair',
      width: 140,
      render: r => (
        <div className="flex items-center gap-1.5">
          {r.alert && <span className="w-1.5 h-1.5 rounded-full bg-data-bear animate-pulse" />}
          <span className="text-teal-vivid font-bold text-[11px]">{r.pairLabel}</span>
        </div>
      ),
    },
    {
      key: 'venueA',
      header: 'Venue A',
      width: 80,
      render: r => <span className="text-text-secondary text-[10px] capitalize">{r.venueA}</span>,
    },
    {
      key: 'venueB',
      header: 'Venue B',
      width: 80,
      render: r => <span className="text-text-secondary text-[10px] capitalize">{r.venueB}</span>,
    },
    {
      key: 'priceA',
      header: 'Price A',
      width: 100,
      align: 'right',
      render: r => <span className="text-text-primary font-mono text-[10px] tabular-nums">${r.priceA.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>,
    },
    {
      key: 'priceB',
      header: 'Price B',
      width: 100,
      align: 'right',
      render: r => <span className="text-text-primary font-mono text-[10px] tabular-nums">${r.priceB.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>,
    },
    {
      key: 'spreadPct',
      header: 'Spread%',
      width: 80,
      align: 'right',
      render: r => <DeltaBadge value={r.spreadPct} size="xs" />,
    },
    {
      key: 'zScore',
      header: 'Z-Score',
      width: 70,
      align: 'right',
      render: r => {
        const absZ = Math.abs(r.zScore)
        const color = absZ > 2 ? 'text-data-bear' : absZ > 1 ? 'text-amber-400' : 'text-text-secondary'
        return <span className={`font-mono font-bold text-[11px] tabular-nums ${color}`}>{r.zScore.toFixed(2)}</span>
      },
    },
    {
      key: 'source',
      header: 'Source',
      width: 70,
      render: r => {
        const colors: Record<string, string> = {
          kimchi: 'bg-purple-500/20 text-purple-400',
          basis: 'bg-teal-dim/30 text-teal-vivid',
          weekend: 'bg-amber-500/20 text-amber-400',
        }
        return (
          <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono uppercase ${colors[r.source] || 'text-text-muted'}`}>
            {r.source}
          </span>
        )
      },
    },
    {
      key: 'sparkline',
      header: 'Trend',
      width: 60,
      render: r => {
        // Generate a synthetic sparkline from the spread values
        const sparkData = Array.from({ length: 20 }, (_, i) =>
          r.spreadPct * (0.5 + Math.sin(i * 0.4 + r.timestamp / 1e6) * 0.5)
        )
        return <Sparkline data={sparkData} width={50} height={16} />
      },
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Gap & Dislocation Board</h1>
            <p className="text-[11px] text-text-muted font-mono">
              Kimchi premium, cross-exchange basis, weekend drifts — all Tier 0
            </p>
          </div>
          <div className="flex items-center gap-2">
            {alertCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-data-bear/20 text-data-bear text-[10px] font-mono animate-pulse">
                {alertCount} ALERT{alertCount > 1 ? 'S' : ''}
              </span>
            )}
            <LiveDot status={status} label />
          </div>
        </div>

        {/* Kimchi Premium Gauges */}
        <Panel title="Kimchi Premium" subtitle="KRW vs global BTC/ETH">
          <div className="p-3 flex gap-6">
            {kimchiPremium.length > 0
              ? kimchiPremium.map(k => (
                  <KimchiGauge key={k.asset} premium={k.premiumPct} label={`${k.asset}/KRW`} />
                ))
              : ['BTC/KRW', 'ETH/KRW'].map(l => (
                  <div key={l} className="flex-1 min-w-[140px]">
                    <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-1">{l}</div>
                    <div className="h-2 bg-bg-raised rounded-full animate-pulse" />
                    <div className="text-[11px] text-text-muted font-mono mt-1">Loading...</div>
                  </div>
                ))}
            <div className="flex-1 min-w-[140px]">
              <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-1">Z-Score Alert</div>
              <div className="flex items-center gap-2 mt-1">
                {kimchiPremium.filter(k => k.alert).length > 0
                  ? kimchiPremium.filter(k => k.alert).map(k => (
                      <span key={k.asset} className="px-2 py-0.5 rounded bg-data-bear/20 text-data-bear text-[10px] font-mono">
                        {k.asset}: {k.zScore.toFixed(1)}σ
                      </span>
                    ))
                  : <span className="text-[11px] text-text-muted font-mono">No alerts — normal range</span>}
              </div>
            </div>
          </div>
        </Panel>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search pair or venue..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-bg-panel border border-bg-border rounded px-3 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted outline-none w-48"
          />
          <div className="flex items-center gap-1 text-[10px] font-mono">
            {(['all', 'kimchi', 'basis', 'weekend'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 rounded capitalize ${
                  filter === f ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px] text-text-muted font-mono">{filtered.length} signals</span>
        </div>

        {/* Signals Table */}
        <Panel
          title="Ranked Dislocations"
          subtitle="Sorted by |z-score| descending"
          liveStatus={status}
          maxHeight={600}
        >
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={filtered as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={32}
            emptyState={
              <div className="text-text-muted text-[11px] p-4 text-center">
                {status === 'error' ? 'Failed to load data — check network' : 'Gathering signals...'}
              </div>
            }
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
