"use client"

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { StatCard } from '@/components/domain/stat-card'
import type {
  GateioPerformanceData,
  GateioLeaderProfile,
  GateioEquityPoint,
  GateioMarketConcentration,
  GateioTrade,
} from '@/lib/modules/derivatives/gateio/performance'

const EMPTY: GateioPerformanceData = { profile: null, equity: [], markets: [], trades: [] }

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}

function fmtHold(seconds: number): string {
  if (seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function EquityCurve({ points }: { points: GateioEquityPoint[] }) {
  if (points.length === 0) {
    return <div className="py-10 text-center text-sm text-text-muted">No equity curve data</div>
  }
  const w = 600
  const h = 160
  const pad = 10
  const vals = points.map((p) => p.profit)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const pts = points
    .map((p, i) => {
      const x = pad + (i / Math.max(points.length - 1, 1)) * (w - 2 * pad)
      const y = h - pad - ((p.profit - min) / range) * (h - 2 * pad)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const last = points[points.length - 1]
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-3">
        <span className="font-mono text-2xl text-teal-vivid">{fmtUsd(last.profit)}</span>
        <span className="text-xs text-text-muted">
          {points.length} points · {new Date(last.timestamp * 1000).toLocaleDateString()}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full text-teal-vivid" role="img" aria-label="Profit curve">
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="4 4" />
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function Concentration({ rows }: { rows: GateioMarketConcentration[] }) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-text-muted">No position concentration data</div>
  }
  const top = rows.slice(0, 8)
  return (
    <div className="space-y-3">
      {top.map((r) => (
        <div key={r.symbol}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-mono text-text-primary">{r.symbol}</span>
            <span className="text-text-muted">{fmtPct(r.percent)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full bg-teal-vivid"
              style={{ width: `${Math.min(r.percent * 100, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function ProfileHeader({ profile }: { profile: GateioLeaderProfile }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {profile.avatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar} alt={profile.nickname} className="h-14 w-14 rounded-full object-cover" />
      )}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-text-primary">{profile.nickname}</span>
          <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">T{profile.tier}</span>
          <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">Lv{profile.level}</span>
          <span className="capitalize text-xs text-text-muted">{profile.status}</span>
        </div>
        {profile.nick && <div className="text-xs text-text-muted">{profile.nick}</div>}
        {profile.style && <div className="mt-0.5 font-mono text-[11px] text-text-muted">{profile.style}</div>}
      </div>
    </div>
  )
}

export default function LeaderPerformancePage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''

  const [data, setData] = useState<GateioPerformanceData>(EMPTY)
  const [degraded, setDegraded] = useState(false)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/copy-trading/performance?leader_id=${id}&platform=gateio`)
      const d = await res.json()
      if (d.data) {
        setData({
          profile: d.data.profile ?? null,
          equity: d.data.equity ?? [],
          markets: d.data.markets ?? [],
          trades: d.data.trades ?? [],
        })
        setDegraded(Boolean(d.data.degraded))
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
    const timer = setInterval(fetchData, 15_000)
    return () => clearInterval(timer)
  }, [id, fetchData])

  const profile = data.profile
  const stats = profile?.stats

  const columns: Column<GateioTrade>[] = [
    { key: 'market', header: 'Market', render: (r) => <span className="font-mono text-text-primary">{r.market}</span> },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      render: (r) => (
        <span className={`font-mono ${r.profit >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
          {r.profit >= 0 ? '+' : ''}
          {fmtUsd(r.profit)}
        </span>
      ),
    },
    { key: 'hold', header: 'Hold', align: 'right', render: (r) => <span className="text-text-muted">{fmtHold(r.holdSeconds)}</span> },
    { key: 'time', header: 'Closed', align: 'right', render: (r) => <span className="text-xs text-text-muted">{fmtTime(r.timestamp)}</span> },
  ]

  return (
    <NexusLayout>
      <Panel
        title={profile ? profile.nickname : `Leader ${id}`}
        subtitle="Gate.io copy-trading performance intelligence"
        liveStatus={status}
        onRefresh={fetchData}
        actions={
          degraded
            ? [<span key="degraded" className="rounded bg-accent-amber/20 px-2 py-0.5 text-[10px] text-accent-amber">degraded</span>]
            : undefined
        }
      >
        {profile ? <ProfileHeader profile={profile} /> : <div className="py-6 text-sm text-text-muted">Profile unavailable</div>}
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Profit" value={stats ? fmtUsd(stats.profit) : '—'} />
        <StatCard label="Profit Rate" value={stats ? fmtPct(stats.profitRate, 2) : '—'} />
        <StatCard label="Win Rate" value={stats ? fmtPct(stats.winRate, 2) : '—'} />
        <StatCard label="Max Drawdown" value={stats ? fmtPct(stats.maxDrawdown, 2) : '—'} />
        <StatCard label="Sharpe" value={stats ? stats.sharpRatio.toFixed(2) : '—'} />
        <StatCard label="AUM" value={stats ? fmtUsd(stats.aum) : '—'} />
        <StatCard label="Follow Profit" value={stats ? fmtUsd(stats.followProfit) : '—'} />
        <StatCard label="Followers" value={stats ? `${stats.currFollowNum} / ${stats.maxFollowNum}` : '—'} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Profit Curve" subtitle="Monthly cumulative profit" className="lg:col-span-2">
          <EquityCurve points={data.equity} />
        </Panel>
        <Panel title="Position Concentration" subtitle="Share of total investment">
          <Concentration rows={data.markets} />
        </Panel>
      </div>

      {profile && profile.markets.length > 0 && (
        <Panel title="Tradable Markets" subtitle={`Top ${profile.markets.length} instruments`}>
          <div className="flex flex-wrap gap-2">
            {profile.markets.map((m) => (
              <span key={m.symbol} className="rounded border border-bg-border px-2 py-1 font-mono text-xs text-text-primary">
                {m.symbol} <span className="text-text-muted">{m.maxLeverage}x</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Recent Trades"
        subtitle="Latest closed copy-trading positions"
        liveStatus={status}
        onRefresh={fetchData}
      >
        {data.trades.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">No recent trades</div>
        ) : (
          <DataTable columns={columns} data={data.trades} maxHeight={420} />
        )}
      </Panel>
    </NexusLayout>
  )
}