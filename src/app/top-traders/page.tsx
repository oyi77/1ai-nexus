"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Trader {
  address: string
  chain: string
  txCount: number
  totalVolume: number
  entityName: string | null
  entityType: string | null
  entityTvl: number
  smartMoneyScore: number
}

const typeColors: Record<string, string> = {
  exchange: 'bg-accent-amber/20 text-accent-amber',
  fund: 'bg-purple-400/20 text-purple-400',
  whale: 'bg-data-bull/20 text-data-bull',
  protocol: 'bg-teal-vivid/20 text-teal-vivid',
  bridge: 'bg-data-bear/20 text-data-bear',
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

export default function TopTradersPage() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [filter, setFilter] = useState<string>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/top-traders')
      const d = await res.json()
      if (d.success && d.data?.traders) {
        setTraders(d.data.traders)
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
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  const filtered = filter === 'all'
    ? traders
    : traders.filter(t => t.entityType === filter)

  const totalVolume = traders.reduce((s, t) => s + t.totalVolume, 0)
  const totalTxs = traders.reduce((s, t) => s + t.txCount, 0)
  const knownTraders = traders.filter(t => t.entityName).length

  const columns: Column<Trader>[] = [
    { key: 'rank', header: '#', width: 50, render: (_r, i) => (
      <span className="text-[11px] font-mono text-text-muted">#{i + 1}</span>
    )},
    { key: 'entity', header: 'Entity / Address', width: 240, render: r => (
      <div className="flex flex-col">
        {r.entityName ? (
          <>
            <span className="text-[11px] font-mono font-bold text-text-primary">{r.entityName}</span>
            <span className="text-[9px] font-mono text-text-muted">{r.address.slice(0, 16)}...</span>
          </>
        ) : (
          <span className="text-[10px] font-mono text-text-muted">{r.address.slice(0, 24)}...</span>
        )}
      </div>
    )},
    { key: 'chain', header: 'Chain', width: 80, render: r => (
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-teal-vivid uppercase">{r.chain}</span>
    )},
    { key: 'type', header: 'Type', width: 100, render: r => (
      r.entityType ? (
        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${typeColors[r.entityType.toLowerCase()] ?? 'bg-bg-raised text-text-muted'}`}>
          {r.entityType.toUpperCase()}
        </span>
      ) : <span className="text-text-muted text-[10px]">Unknown</span>
    )},
    { key: 'txCount', header: 'Tx Count', width: 80, align: 'right', render: r => (
      <span className="text-[12px] font-mono font-bold text-text-primary tabular-nums">{r.txCount}</span>
    )},
    { key: 'totalVolume', header: 'Volume', width: 110, align: 'right', render: r => (
      <PriceTag value={r.totalVolume} size="sm" />
    )},
    { key: 'entityTvl', header: 'Entity TVL', width: 110, align: 'right', render: r => (
      <span className="text-[11px] font-mono text-text-secondary tabular-nums">
        {r.entityTvl > 0 ? fmtUsd(r.entityTvl) : '—'}
      </span>
    )},
    { key: 'score', header: 'SM Score', width: 80, align: 'right', render: r => (
      <span className="text-[12px] font-mono font-bold text-teal-vivid tabular-nums">
        {r.smartMoneyScore || '—'}
      </span>
    )},
  ]

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">🏆</span> Top Traders Leaderboard
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Most active wallets ranked by live transaction count. Entity attribution from DeFiLlama.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-2">
          <KPI label="Total Traders" value={String(traders.length)} />
          <KPI label="Total Tx Count" value={String(totalTxs)} />
          <KPI label="Total Volume" value={fmtUsd(totalVolume)} />
          <KPI label="Identified Entities" value={`${knownTraders}/${traders.length}`} />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-text-muted uppercase">Filter:</span>
          <div className="flex bg-bg-raised p-1 rounded">
            {(['all', 'exchange', 'fund', 'protocol', 'whale', 'bridge'] as const).map(f => (
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

        {/* Table */}
        <Panel title="Leaderboard" subtitle={`${filtered.length} ranked traders`} liveStatus={status} onRefresh={fetchData}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={filtered as unknown as Record<string, unknown>[]}
            rowHeight={36}
            emptyState={<div className="text-text-muted text-[12px] p-8 text-center">No traders yet. Indexer is collecting transactions...</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className="text-[16px] font-head font-bold tabular-nums text-text-primary">{value}</div>
    </div>
  )
}