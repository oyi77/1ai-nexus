"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { StatCard } from '@/components/domain/stat-card'
import type { CopyTradingLeader } from '@/lib/modules/market/copy-trading/types'

const CYCLES = ['day', 'week', 'month'] as const

const ENABLED_PLATFORMS = ['all', 'gateio', 'hyperliquid', 'binance', 'bitget', 'okx'] as const
type EnabledPlatform = (typeof ENABLED_PLATFORMS)[number]

const platformColors: Record<string, string> = {
  gateio: 'bg-teal-vivid/20 text-teal-vivid',
  hyperliquid: 'bg-accent-amber/20 text-accent-amber',
  binance: 'bg-yellow-500/20 text-yellow-500', // Binance yellow
  bitget: 'bg-orange-500/20 text-orange-500', // Bitget orange
  okx: 'bg-blue-500/20 text-blue-500', // OKX blue
}

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

/** Fetch top-N leaders for an order_by dimension. null → response shape missing (auth/error). */
async function fetchLeaders(
  platform: EnabledPlatform,
  cycle: (typeof CYCLES)[number],
  orderBy: 'win_rate' | 'profit',
): Promise<CopyTradingLeader[] | null> {
  const res = await fetch(
    `/api/v1/copy-trading/leaderboard?platform=${platform}&cycle=${cycle}&order_by=${orderBy}&page_size=20`,
  )
  const d = await res.json()
  if (!d.data?.leaders || d.error) return null
  return d.data.leaders as CopyTradingLeader[]
}

export default function CopyTradingPerformancePage() {
  const [winRateLeaders, setWinRateLeaders] = useState<CopyTradingLeader[]>([])
  const [profitLeaders, setProfitLeaders] = useState<CopyTradingLeader[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [platform, setPlatform] = useState<EnabledPlatform>('all')
  const [cycle, setCycle] = useState<(typeof CYCLES)[number]>('month')

  const fetchData = useCallback(async () => {
    try {
      const [wr, pr] = await Promise.all([
        fetchLeaders(platform, cycle, 'win_rate'),
        fetchLeaders(platform, cycle, 'profit'),
      ])
      if (!wr || !pr) {
        // Envelope missing (401 without a key, upstream failure) — mirror leaderboard error path
        setStatus('error')
        return
      }
      setWinRateLeaders(wr)
      setProfitLeaders(pr)
      setStatus('live')
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

  const topWinRate = winRateLeaders[0]?.winRate ?? 0
  const topProfit = profitLeaders[0]?.profit ?? 0
  const avgWinRate = winRateLeaders.length
    ? winRateLeaders.reduce((s, l) => s + l.winRate, 0) / winRateLeaders.length
    : 0
  // Combined AUM across both fetched sets, deduped by platform:id
  const seen = new Set<string>()
  let combinedAum = 0
  for (const l of [...winRateLeaders, ...profitLeaders]) {
    const key = `${l.platform}:${l.id}`
    if (!seen.has(key)) {
      seen.add(key)
      combinedAum += l.aum
    }
  }

  const goLeader = (r: CopyTradingLeader): void => {
    window.location.href = `/copy-trading/leader/${r.id}?platform=${r.platform}`
  }

  const leaderCell = (r: CopyTradingLeader) => (
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
  )

  const platformCell = (r: CopyTradingLeader) => (
    <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded uppercase ${platformColors[r.platform] ?? 'bg-bg-raised text-text-muted'}`}>
      {r.platform}
    </span>
  )

  const rankCell = (_r: CopyTradingLeader, i: number | undefined) => (
    <span className="text-xs font-mono text-text-muted">#{i === undefined ? '—' : i + 1}</span>
  )

  const winRateColumns: Column<CopyTradingLeader>[] = [
    { key: 'rank', header: '#', width: 50, render: rankCell },
    { key: 'trader', header: 'Leader', width: 220, render: leaderCell },
    { key: 'platform', header: 'Platform', width: 100, render: platformCell },
    { key: 'winRate', header: 'Win Rate', width: 90, align: 'right', render: r => (
      <span className="text-xs font-mono tabular-nums text-text-primary">{fmtPct(r.winRate)}</span>
    )},
    { key: 'profit', header: 'Total Profit', width: 110, align: 'right', render: r => (
      <PriceTag value={r.profit} size="sm" />
    )},
    { key: 'aum', header: 'AUM', width: 110, align: 'right', render: r => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">{r.aum > 0 ? fmtUsd(r.aum) : '—'}</span>
    )},
    { key: 'followers', header: 'Followers', width: 90, align: 'right', render: r => (
      <span className="text-xs font-mono font-bold text-text-primary tabular-nums">{r.followers || '—'}</span>
    )},
  ]

  const profitColumns: Column<CopyTradingLeader>[] = [
    { key: 'rank', header: '#', width: 50, render: rankCell },
    { key: 'trader', header: 'Leader', width: 220, render: leaderCell },
    { key: 'platform', header: 'Platform', width: 100, render: platformCell },
    { key: 'profit', header: 'Profit', width: 110, align: 'right', render: r => (
      <PriceTag value={r.profit} size="sm" />
    )},
    { key: 'profitRate', header: 'Profit Rate', width: 90, align: 'right', render: r => (
      <span className="text-xs font-mono tabular-nums text-data-bull">{fmtPct(r.profitRate)}</span>
    )},
    { key: 'aum', header: 'AUM', width: 110, align: 'right', render: r => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">{r.aum > 0 ? fmtUsd(r.aum) : '—'}</span>
    )},
  ]

  const emptyState = status === 'error' ? (
    <div className="text-text-muted text-[12px] p-8 text-center">API access requires a key — data unavailable</div>
  ) : (
    <div className="text-text-muted text-[12px] p-8 text-center">No leaders yet. Fetching from Gate.io + Hyperliquid + Binance + Bitget + OKX...</div>
  )

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">📈</span> Performance Intelligence
            </h1>
            <p className="text-[12px] text-text-muted mt-1">
              Copy-trading leader performance: top win rates and profit gainers. Gate.io + Hyperliquid + Binance + Bitget + OKX.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Stat card row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Top Win Rate" value={topWinRate ? fmtPct(topWinRate) : '—'} />
          <StatCard label="Top Profit" value={topProfit ? fmtUsd(topProfit) : '—'} />
          <StatCard label="Avg Win Rate" value={avgWinRate ? fmtPct(avgWinRate) : '—'} />
          <StatCard label="Combined AUM" value={combinedAum ? fmtUsd(combinedAum) : '—'} />
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

        {/* Top by win rate */}
        <Panel
          title="Top by Win Rate"
          subtitle={`${winRateLeaders.length} leaders · ${cycle} cycle · platform ${platform}`}
          liveStatus={status}
          onRefresh={fetchData}
        >
          <DataTable
            columns={winRateColumns as unknown as Column<Record<string, unknown>>[]}
            data={winRateLeaders as unknown as Record<string, unknown>[]}
            sortable
            filterable
            filterPlaceholder="Filter leaders…"
            rowHeight={36}
            onRowClick={(row) => goLeader(row as unknown as CopyTradingLeader)}
            emptyState={emptyState}
          />
        </Panel>

        {/* Top profit gainers */}
        <Panel
          title="Top Profit Gainers"
          subtitle={`${profitLeaders.length} leaders · ${cycle} cycle · platform ${platform}`}
          liveStatus={status}
          onRefresh={fetchData}
        >
          <DataTable
            columns={profitColumns as unknown as Column<Record<string, unknown>>[]}
            data={profitLeaders as unknown as Record<string, unknown>[]}
            sortable
            filterable
            filterPlaceholder="Filter leaders…"
            rowHeight={36}
            maxHeight={320}
            onRowClick={(row) => goLeader(row as unknown as CopyTradingLeader)}
            emptyState={emptyState}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}