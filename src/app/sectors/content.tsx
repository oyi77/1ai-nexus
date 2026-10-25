"use client"

import { useMemo } from 'react'
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
  chainTvls?: Record<string, number>
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
export function aggregateChains(list: Protocol[]): ChainRow[] {
  const chainMap = new Map<string, { tvl: number; change1d: number; change7d: number; weight1d: number; weight7d: number; count: number; topTvl: number; topName: string }>()

  for (const p of list) {
    if (!p.chains || !p.chainTvls) continue
    for (const chain of p.chains) {
      const chainTvl = p.chainTvls[chain]
      if (!Number.isFinite(chainTvl) || chainTvl <= 0) continue
      let entry = chainMap.get(chain)
      if (!entry) {
        entry = { tvl: 0, change1d: 0, change7d: 0, weight1d: 0, weight7d: 0, count: 0, topTvl: 0, topName: '' }
        chainMap.set(chain, entry)
      }
      entry.tvl += chainTvl
      entry.count += 1
      if (chainTvl > entry.topTvl) {
        entry.topTvl = chainTvl
        entry.topName = p.name
      }
      if (p.change_1d != null && isFinite(p.change_1d)) {
        entry.change1d += p.change_1d * chainTvl
        entry.weight1d += chainTvl
      }
      if (p.change_7d != null && isFinite(p.change_7d)) {
        entry.change7d += p.change_7d * chainTvl
        entry.weight7d += chainTvl
      }
    }
  }

  const totalTvl = Array.from(chainMap.values()).reduce((sum, entry) => sum + entry.tvl, 0)
  return Array.from(chainMap.entries())
    .map(([name, entry]): ChainRow => ({
      name,
      tvl: entry.tvl,
      change1d: entry.weight1d > 0 ? entry.change1d / entry.weight1d : null,
      change7d: entry.weight7d > 0 ? entry.change7d / entry.weight7d : null,
      dominance: totalTvl > 0 ? (entry.tvl / totalTvl) * 100 : 0,
      protocolCount: entry.count,
      topProtocol: entry.topName,
    }))
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 30)
}

 function SectorsPageInner() {
  const { data: protocols, status, refresh } = useLiveFetch<Protocol[] | { data?: Protocol[] }>({
     url: '/api/v1/modules/fetch?module=defillama&action=protocols',
     interval: 300_000,
     initialData: [],
   })

  const chains = useMemo(() => {
    const list = Array.isArray(protocols) ? protocols : protocols?.data ?? []
    return aggregateChains(Array.isArray(list) ? list : [])
  }, [protocols])

  const columns: Column<ChainRow>[] = [
    { key: 'name', header: 'Chain', width: 120, render: r => <span className="text-teal-vivid font-bold">{r.name}</span> },
    { key: 'tvl', header: 'TVL', width: 100, align: 'right', render: r => <PriceTag value={r.tvl} size="sm" /> },
    { key: 'change1d', header: '24h%', width: 70, align: 'right', render: r => r.change1d != null ? <DeltaBadge value={r.change1d} size="xs" /> : <span className="text-text-muted text-xs font-mono">—</span> },
    { key: 'change7d', header: '7d%', width: 70, align: 'right', render: r => r.change7d != null ? <DeltaBadge value={r.change7d} size="xs" /> : <span className="text-text-muted text-xs font-mono">—</span> },
    { key: 'dominance', header: 'Dom', width: 60, align: 'right', render: r => <span className="text-text-primary">{r.dominance.toFixed(2)}%</span> },
    { key: 'protocolCount', header: 'Protocols', width: 70, align: 'right', render: r => <span className="text-text-dim text-xs">{r.protocolCount}</span> },
    { key: 'topProtocol', header: 'Top Protocol', width: 120, render: r => <span className="text-text-dim text-xs">{r.topProtocol}</span> },
  ]

  return (
    <>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">DeFi Sectors</h1>
            <p className="text-xs text-text-muted">Chain TVL breakdown with 24h/7d changes — weighted by protocol TVL</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-mono">{chains.length} chains</span>
            <LiveDot status={status} label />
          </div>
        </div>

        {/* Summary strip */}
        {chains.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-xs text-text-muted">TOTAL TVL</p>
              <PriceTag value={chains.reduce((s, c) => s + c.tvl, 0)} size="md" />
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-xs text-text-muted">TOP CHAIN</p>
              <p className="text-sm font-bold text-teal-vivid">{chains[0]?.name}</p>
              <p className="text-xs text-text-dim">{chains[0]?.dominance.toFixed(1)}% dominance</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-xs text-text-muted">BIGGEST 24h GAIN</p>
              {(() => {
                const best = chains.reduce((b, c) => (c.change1d ?? -Infinity) > (b.change1d ?? -Infinity) ? c : b, chains[0])
                return best?.change1d != null ? <DeltaBadge value={best.change1d} size="sm" /> : <span className="text-text-dim">—</span>
              })()}
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-xs text-text-muted">BIGGEST 24h DROP</p>
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
            emptyState={<div className="text-text-muted text-xs p-4">{status === 'error' ? 'Failed to load' : 'Loading DeFi sector data...'}</div>}
          />
        </Panel>
      </div>
    </>
  )
}
