"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import type { CopyTradingLeader, CopyTradingPlatform } from '@/lib/modules/market/copy-trading/types'

interface LeaderboardMeta {
  platforms: Array<{ platform: CopyTradingPlatform; status: 'ok' | 'error'; error?: string; total?: number }>
  total: number
  updatedAt: string
}

const platformColors: Record<string, string> = {
  gateio: 'bg-teal-vivid/20 text-teal-vivid',
  hyperliquid: 'bg-accent-amber/20 text-accent-amber',
  binance: 'bg-yellow-500/20 text-yellow-500',
  bitget: 'bg-orange-500/20 text-orange-500',
  okx: 'bg-blue-500/20 text-blue-500',  // OKX blue
}

const ENABLED_PLATFORMS = ['all', 'gateio', 'hyperliquid', 'binance', 'bitget', 'okx'] as const
type EnabledPlatform = typeof ENABLED_PLATFORMS[number]

const CYCLES = ['day', 'week', 'month'] as const

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtPct(n: number): string {
  if (n === 0) return '—'
  return `${(n * 100).toFixed(1)}%`
}

export default function CopyTradingPage() {
  const [leaders, setLeaders] = useState<CopyTradingLeader[]>([])
  const [meta, setMeta] = useState<LeaderboardMeta | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [platform, setPlatform] = useState<EnabledPlatform>('all')
  const [cycle, setCycle] = useState<(typeof CYCLES)[number]>('month')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/copy-trading/leaderboard?platform=${platform}&cycle=${cycle}`)
      const d = await res.json()
      if (d.data?.leaders) {
        setLeaders(d.data.leaders)
        setMeta(d.data.meta)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [platform, cycle])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
    const id = setInterval(fetchData, 15_000)
    return () => clearInterval(id)
  }, [fetchData])

  const totalAum = leaders.reduce((s, l) => s + l.aum, 0)
  const totalFollowers = leaders.reduce((s, l) => s + l.followers, 0)
  const platformStatus = meta?.platforms
    ? meta.platforms.filter(p => p.status === 'ok').length
    : 0

  const columns: Column<CopyTradingLeader>[] = [
    { key: 'rank', header: '#', width: 50, render: (_r, i) => (
      <span className="text-xs font-mono text-text-muted">#{i + 1}</span>
    )},
    { key: 'trader', header: 'Trader', width: 220, render: r => (
      <div className="flex items-center gap-2">
        {r.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.avatar} alt="" width={18} height={18} className="rounded-full bg-bg-raised" />
        ) : (
          <span className="w-[18px] h-[18px] rounded-full bg-bg-raised flex items-center justify-center text-xs font-mono text-text-muted">
            {(r.nick?.[0] ?? '?').toUpperCase()}
          </span>
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-mono font-bold text-text-primary truncate max-w-[130px]">{r.nick}</span>
          <span className="text-xs font-mono text-text-muted">{r.id.slice(0, 14)}</span>
        </div>
      </div>
    )},
    { key: 'platform', header: 'Platform', width: 100, render: r => (
      <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded uppercase ${platformColors[r.platform] ?? 'bg-bg-raised text-text-muted'}`}>
        {r.platform}
      </span>
    )},
    { key: 'level', header: 'Lvl', width: 55, render: r => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">{r.level || '—'}</span>
    )},
    { key: 'profit', header: 'Profit', width: 100, align: 'right', render: r => (
      <PriceTag value={r.profit} size="sm" />
    )},
    { key: 'profitRate', header: 'Profit Rate', width: 90, align: 'right', render: r => (
      <span className="text-xs font-mono tabular-nums text-data-bull">{fmtPct(r.profitRate)}</span>
    )},
    { key: 'winRate', header: 'Win Rate', width: 90, align: 'right', render: r => (
      <span className="text-xs font-mono tabular-nums text-text-primary">{fmtPct(r.winRate)}</span>
    )},
    { key: 'maxDrawdown', header: 'Max DD', width: 80, align: 'right', render: r => (
      <span className="text-xs font-mono tabular-nums text-data-bear">{r.maxDrawdown ? `-${(r.maxDrawdown * 100).toFixed(1)}%` : '—'}</span>
    )},
    { key: 'aum', header: 'AUM', width: 110, align: 'right', render: r => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">{r.aum > 0 ? fmtUsd(r.aum) : '—'}</span>
    )},
    { key: 'followers', header: 'Followers', width: 90, align: 'right', render: r => (
      <span className="text-xs font-mono font-bold text-text-primary tabular-nums">{r.followers || '—'}</span>
    )},
    { key: 'labels', header: 'Labels', width: 160, render: r => (
      <div className="flex gap-1 flex-wrap">
        {r.labels.slice(0, 3).map(label => (
          <span key={label} className="text-xs font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted">{label}</span>
        ))}
        {r.labels.length === 0 && <span className="text-text-muted text-xs">—</span>}
      </div>
    )},
  ]

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">🎯</span> Copy Trading Leaderboard
            </h1>
            <p className="text-[12px] text-text-muted mt-1">
              Top copy-trading leaders ranked by performance. Gate.io via gate.tv web API, Hyperliquid, Binance, Bitget + OKX leaderboards.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-2">
          <KPI label="Total Leaders" value={String(leaders.length)} />
          <KPI label="Combined AUM" value={fmtUsd(totalAum)} />
          <KPI label="Total Followers" value={String(totalFollowers)} />
          <KPI label="Platforms Online" value={`${platformStatus}/${meta?.platforms.length ?? 0}`} />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-text-muted uppercase">Platform:</span>
            <div className="flex bg-bg-raised p-1 rounded">
              {ENABLED_PLATFORMS.map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`px-3 py-1 text-xs font-mono rounded uppercase transition-colors ${platform === p ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-text-muted uppercase">Cycle:</span>
            <select
              value={cycle}
              onChange={e => setCycle(e.target.value as (typeof CYCLES)[number])}
              className="bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-text-primary"
            >
              {CYCLES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <Panel title="Leaderboard" subtitle={`${leaders.length} ranked leaders · ${meta?.platforms.map(p => `${p.platform}:${p.status}`).join(' · ') ?? ''}`} liveStatus={status} onRefresh={fetchData}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={leaders as unknown as Record<string, unknown>[]}
            sortable
            filterable
            filterPlaceholder="Filter leaders…"
            rowHeight={36}
            onRowClick={(row) => {
              const r = row as unknown as CopyTradingLeader
              window.location.href = `/copy-trading/leader/${r.id}?platform=${r.platform}`
            }}
            emptyState={<div className="text-text-muted text-[12px] p-8 text-center">No leaders yet. Fetching from gate.io, Hyperliquid, Binance, Bitget + OKX...</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-xs text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className="text-[16px] font-head font-bold tabular-nums text-text-primary">{value}</div>
    </div>
  )
}