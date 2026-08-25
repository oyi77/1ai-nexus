"use client"

import { useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface Protocol {
  name: string
  chain: string
  chains: string[]
  tvl: number
  change_1d: number | null
  change_7d: number | null
  category?: string
}

interface ChainRow {
  name: string
  tvl: number
  change1d: number | null
  change7d: number | null
  dominance: number
  protocolCount: number
  topProtocol: string
}

export function SectorsPageContent() {
  return <SectorsPageInner />
}

export default function SectorsPage() {
  return <NexusLayout><SectorsPageInner /></NexusLayout>
}

function SectorsPageInner() {
  const { data: protocols, status, refresh } = useLiveFetch<Protocol[]>({
    url: '/api/v1/modules/fetch?module=defillama&action=protocols',
    interval: 300_000,
    initialData: [],
  })

  const chains = useMemo(() => {
    const list = Array.isArray(protocols) ? protocols : (protocols as unknown as { data: Protocol[] })?.data ?? []
    if (!Array.isArray(list) || list.length === 0) return []

    // Aggregate by chain
    const chainMap = new Map<string, { tvl: number; weightedChange1d: number; weightedChange7d: number; totalWeight: number; count: number; topTvl: number; topName: string }>()

    for (const p of list) {
      if (!p.chains || p.tvl <= 0) continue
      for (const chain of p.chains) {
        let entry = chainMap.get(chain)
        if (!entry) {
          entry = { tvl: 0, weightedChange1d: 0, weightedChange7d: 0, totalWeight: 0, count: 0, topTvl: 0, topName: '' }
          chainMap.set(chain, entry)
        }
        entry.tvl += p.tvl
        entry.count += 1
        if (p.tvl > entry.topTvl) {
          entry.topTvl = p.tvl
          entry.topName = p.name
        }
        // Weighted average of changes by TVL
        if (p.change_1d != null && isFinite(p.change_1d)) {
          entry.weightedChange1d += p.change_1d * p.tvl
          entry.totalWeight += p.tvl
        }
      }
    }

    // Also compute weighted 7d change
    for (const p of list) {
      if (!p.chains || p.tvl <= 0 || p.change_7d == null || !isFinite(p.change_7d)) continue
      for (const chain of p.chains) {
        const entry = chainMap.get(chain)
        if (entry) {
          entry.weightedChange7d += p.change_7d * p.tvl
        }
      }
    }

    const totalTvl = Array.from(chainMap.values()).reduce((s, e) => s + e.tvl, 0)

    return Array.from(chainMap.entries())
      .map(([name, e]): ChainRow => ({
        name,
        tvl: e.tvl,
        change1d: e.totalWeight > 0 ? e.weightedChange1d / e.totalWeight : null,
        change7d: e.totalWeight > 0 ? e.weightedChange7d / e.totalWeight : null,
        dominance: totalTvl > 0 ? (e.tvl / totalTvl) * 100 : 0,
        protocolCount: e.count,
        topProtocol: e.topName,
      }))
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 30)
  }, [protocols])

  const columns: Column<ChainRow>[] = [
    { key: 'name', header: 'Chain', width: 120, render: r => <span className="text-teal-vivid font-bold">{r.name}</span> },
    { key: 'tvl', header: 'TVL', width: 100, align: 'right', render: r => <PriceTag value={r.tvl} size="sm" /> },
    { key: 'change1d', header: '24h%', width: 70, align: 'right', render: r => r.change1d != null ? <DeltaBadge value={r.change1d} size="xs" /> : <span className="text-text-muted text-[10px] font-mono">—</span> },
    { key: 'change7d', header: '7d%', width: 70, align: 'right', render: r => r.change7d != null ? <DeltaBadge value={r.change7d} size="xs" /> : <span className="text-text-muted text-[10px] font-mono">—</span> },
    { key: 'dominance', header: 'Dom', width: 60, align: 'right', render: r => <span className="text-text-primary">{r.dominance.toFixed(2)}%</span> },
    { key: 'protocolCount', header: 'Protocols', width: 70, align: 'right', render: r => <span className="text-text-dim text-[10px]">{r.protocolCount}</span> },
    { key: 'topProtocol', header: 'Top Protocol', width: 120, render: r => <span className="text-text-dim text-[10px]">{r.topProtocol}</span> },
  ]

  return (
    <>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">DeFi Sectors</h1>
            <p className="text-[11px] text-text-muted font-mono">Chain TVL breakdown with 24h/7d changes — weighted by protocol TVL</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted font-mono">{chains.length} chains</span>
            <LiveDot status={status} label />
          </div>
        </div>

        {/* Summary strip */}
        {chains.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">TOTAL TVL</p>
              <PriceTag value={chains.reduce((s, c) => s + c.tvl, 0)} size="md" />
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">TOP CHAIN</p>
              <p className="text-sm font-mono font-bold text-teal-vivid">{chains[0]?.name}</p>
              <p className="text-[10px] text-text-dim">{chains[0]?.dominance.toFixed(1)}% dominance</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">BIGGEST 24h GAIN</p>
              {(() => {
                const best = chains.reduce((b, c) => (c.change1d ?? -Infinity) > (b.change1d ?? -Infinity) ? c : b, chains[0])
                return best?.change1d != null ? <DeltaBadge value={best.change1d} size="sm" /> : <span className="text-text-dim">—</span>
              })()}
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">BIGGEST 24h DROP</p>
              {(() => {
                const worst = chains.reduce((w, c) => (c.change1d ?? Infinity) < (w.change1d ?? Infinity) ? c : w, chains[0])
                return worst?.change1d != null ? <DeltaBadge value={worst.change1d} size="sm" /> : <span className="text-text-dim">—</span>
              })()}
            </div>
          </div>
        )}

        <Panel title="Chain TVL Rankings" subtitle={`Top 30 by TVL`} liveStatus={status} onRefresh={refresh} maxHeight={600}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={chains as unknown as Record<string, unknown>[]}
            sortable
            filterable
            filterPlaceholder="Filter chains…"
            rowHeight={28}
            emptyState={<div className="text-text-muted text-[11px] p-4">{status === 'error' ? 'Failed to load' : 'Loading DeFi sector data...'}</div>}
          />
        </Panel>
      </div>
    </>
  )
}
