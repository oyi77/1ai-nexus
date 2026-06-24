"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { AddressChip } from '@/components/primitives/AddressChip'
import { EntityLabel } from '@/components/primitives/EntityLabel'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { Sparkline } from '@/components/primitives/Sparkline'

interface Entity {
  id: string
  name: string
  type: string
  chains: string[]
  totalUsdValue: number
  change1d: number
  verified: boolean
  wallets: Array<{ address: string; chain: string }>
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string>('all')

  const fetchEntities = useCallback(async () => {
    try {
      // Use real entity labels from the API
      const res = await fetch('/api/v1/entities')
      const data = await res.json()

      const items = data.data ?? data
      if (Array.isArray(items)) {
        setEntities(items.map((e: Record<string, unknown>, i: number) => ({
          id: (e.id as string) || String(i),
          name: (e.name as string) || 'Unknown',
          type: (e.type as string) || 'unknown',
          chains: Array.isArray(e.chains) ? e.chains as string[] : ['ethereum'],
          totalUsdValue: (e.totalUsdValue as number) || 0,
          change1d: (e.change1d as number) || 0,
          verified: Boolean(e.verified),
          wallets: Array.isArray(e.wallets) ? e.wallets as Array<{ address: string; chain: string }> : [],
          createdAt: (e.createdAt as string) || '',
          updatedAt: (e.updatedAt as string) || '',
        })))
      }
      setFeedStatus('live')
    } catch {
      setFeedStatus('error')
    }
  }, [])

  useEffect(() => {
    const invoke = () => fetchEntities()
    invoke()
    const interval = setInterval(fetchEntities, 60_000)
    return () => clearInterval(interval)
  }, [fetchEntities])

  const filtered = entities.filter(e => {
    if (filterType !== 'all' && e.type.toLowerCase() !== filterType.toLowerCase()) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const entityTypes = ['all', 'Exchange', 'Fund', 'Whale', 'Protocol', 'Government', 'Unknown']

  const columns: Column<Entity>[] = [
    {
      key: 'name',
      header: 'Entity',
      width: 150,
      render: (row) => (
        <div className="flex items-center gap-2">
          <EntityLabel type={row.type.toLowerCase() as 'whale' | 'cex' | 'fund' | 'protocol'} size="xs" />
          <span className="text-text-primary font-medium truncate">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 80,
      render: (row) => <span className="text-text-secondary text-[10px]">{row.type}</span>,
    },
    {
      key: 'chains',
      header: 'Chain',
      width: 80,
      render: (row) => <span className="text-text-muted text-[10px]">{row.chains[0]}</span>,
    },
    {
      key: 'totalUsdValue',
      header: 'TVL',
      width: 120,
      align: 'right',
      render: (row) => <PriceTag value={row.totalUsdValue} size="sm" />,
    },
    {
      key: 'change1d',
      header: '24h',
      width: 70,
      align: 'right',
      render: (row) => (
        <span className={`font-mono ${row.change1d > 0 ? 'text-data-bull' : 'text-data-bear'}`}>
          {row.change1d > 0 ? '+' : ''}{(row.change1d ?? 0).toFixed(2)}%
        </span>
      ),
    },
    {
      key: 'verified',
      header: 'Status',
      width: 60,
      render: (row) => row.verified ? <span className="text-data-bull text-[10px]">✓</span> : <span className="text-text-muted text-[10px]">—</span>,
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Wallet / Entity Intelligence</h1>
            <p className="text-[11px] text-text-muted font-mono">Arkham-style wallet profiling — label, cluster, history, PnL</p>
          </div>
          <LiveDot status={feedStatus} label />
        </div>

        {/* Search + Filter */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search address or entity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-bg-panel border border-bg-border rounded px-3 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted outline-none w-64"
          />
          <div className="flex items-center gap-1 text-[10px] font-mono">
            {entityTypes.map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-2 py-1 rounded ${filterType === t ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {t === 'all' ? 'ALL' : t.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px] text-text-muted font-mono">{filtered.length} entities</span>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
          {/* Entity List */}
          <div className="lg:col-span-2">
            <Panel
              title="Entity Database"
              subtitle="Known wallets and organizations"
              liveStatus={feedStatus}
              onRefresh={fetchEntities}
              maxHeight={600}
            >
              <DataTable
                columns={columns}
                data={filtered}
                sortable
                rowHeight={32}
                onRowClick={(row) => setSelectedEntity(row)}
                emptyState={<div className="text-text-muted text-[11px] p-4">Loading entities...</div>}
              />
            </Panel>
          </div>

          {/* Entity Detail */}
          <Panel
            title={selectedEntity ? selectedEntity.name : 'Entity Profile'}
            subtitle="Select an entity to view details"
            liveStatus={feedStatus}
            maxHeight={600}
          >
            {selectedEntity ? (
              <div className="p-3 space-y-4">
                {/* Entity Header */}
                <div className="text-center">
                  <EntityLabel type={selectedEntity.type.toLowerCase() as 'whale' | 'cex' | 'fund' | 'protocol'} label={selectedEntity.type} size="md" />
                  <div className="mt-2 text-[14px] font-head font-bold text-text-primary">{selectedEntity.name}</div>
                  {selectedEntity.wallets?.[0] && (
                    <AddressChip address={selectedEntity.wallets[0].address} truncate={8} size="sm" />
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'TVL', value: `$${(selectedEntity.totalUsdValue / 1e6).toFixed(1)}M` },
                    { label: '24h Change', value: `${selectedEntity.change1d > 0 ? '+' : ''}${(selectedEntity.change1d ?? 0).toFixed(2)}%` },
                    { label: 'Type', value: selectedEntity.type },
                    { label: 'Chains', value: selectedEntity.chains.join(', ') },
                    { label: 'Wallets', value: String(selectedEntity.wallets.length) },
                    { label: 'Status', value: selectedEntity.verified ? 'Verified' : 'Unverified' },
                  ].map((stat, i) => (
                    <div key={i} className="bg-bg-raised rounded p-2">
                      <div className="text-[9px] text-text-muted font-mono uppercase">{stat.label}</div>
                      <div className="text-[12px] font-mono text-text-primary">{stat.value}</div>
                    </div>
                  ))}
                </div>

                {/* Wallets */}
                {selectedEntity.wallets.length > 0 && (
                  <div>
                    <div className="text-[10px] text-text-muted font-mono mb-1">WALLETS ({selectedEntity.wallets.length})</div>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto">
                      {selectedEntity.wallets.slice(0, 5).map((w, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-bg-raised text-text-muted uppercase">{w.chain}</span>
                          <AddressChip address={w.address} truncate={12} size="sm" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-[11px]">
                Select an entity from the list
              </div>
            )}
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
