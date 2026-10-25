"use client"

import { useState } from 'react'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface DexPool {
  address: string
  name: string
  symbol: string
  priceUsd: number
  volume24h: number
  priceChange24h: number
  liquidity: number | null
  buys24h: number | null
  sells24h: number | null
  dex: string | null
  source: string
  [key: string]: unknown
}

const NETWORKS = ['solana', 'ethereum', 'base', 'bsc']
const VOLUME_FLOORS = [0, 100_000, 1_000_000, 10_000_000]
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('en-US')
const unwrapPools = (payload: unknown): DexPool[] => {
  if (!payload || typeof payload !== 'object' || !('items' in payload) || !Array.isArray(payload.items)) return []
  return payload.items as DexPool[]
}

export function DexMonitorPageContent() {
  const [network, setNetwork] = useState('solana')
  const [minVolume, setMinVolume] = useState(0)
  const [filterDex, setFilterDex] = useState('all')
  const { data: pools, status } = useLiveFetch<DexPool[]>({
    url: `/api/v1/dex/trending?network=${network}`,
    interval: 60_000,
    initialData: [],
    transform: unwrapPools,
  })
  const dexes = ['all', ...new Set(pools.flatMap(pool => pool.dex ? [pool.dex] : []))]
  const filteredPools = pools.filter(pool => pool.volume24h >= minVolume && (filterDex === 'all' || pool.dex === filterDex))

  const columns: Column<DexPool>[] = [
    { key: 'name', header: 'Pool', width: 180, accessor: row => row.name, render: row => <span className="text-teal-vivid font-bold">{row.name}</span> },
    { key: 'dex', header: 'DEX', width: 120, accessor: row => row.dex ?? '', render: row => <span className="text-text-secondary">{row.dex ?? '—'}</span> },
    { key: 'priceUsd', header: 'Price', width: 100, align: 'right', render: row => <PriceTag value={row.priceUsd} size="sm" /> },
    { key: 'priceChange24h', header: '24h Δ', width: 80, align: 'right', render: row => <DeltaBadge value={row.priceChange24h} size="xs" /> },
    { key: 'volume24h', header: '24h Volume', width: 120, align: 'right', render: row => <span className="text-text-primary">{usd.format(row.volume24h)}</span> },
    { key: 'liquidity', header: 'Liquidity', width: 110, align: 'right', render: row => <span className="text-text-muted">{row.liquidity === null ? '—' : usd.format(row.liquidity)}</span> },
    { key: 'buys24h', header: 'Buys 24h', width: 90, align: 'right', render: row => <span className="text-text-secondary">{row.buys24h === null ? '—' : integer.format(row.buys24h)}</span> },
    { key: 'sells24h', header: 'Sells 24h', width: 90, align: 'right', render: row => <span className="text-text-secondary">{row.sells24h === null ? '—' : integer.format(row.sells24h)}</span> },
    { key: 'source', header: 'Source', width: 120, render: row => <span className="text-text-muted font-mono text-[10px]">{row.source}</span> },
  ]

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-head font-bold text-text-primary">DEX Pool Monitor</h1>
          <p className="text-xs text-text-muted">Trending pools and 24h pool metrics from GeckoTerminal, DexScreener, and CoinGecko</p>
        </div>
        <LiveDot status={status} label />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
        <div className="flex items-center gap-1">
          <span className="text-text-muted">Network:</span>
          {NETWORKS.map(value => (
            <button key={value} onClick={() => { setNetwork(value); setFilterDex('all') }} className={`px-2 py-1 rounded ${network === value ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>{value.toUpperCase()}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-text-muted">Min 24h Volume:</span>
          {VOLUME_FLOORS.map(value => (
            <button key={value} onClick={() => setMinVolume(value)} className={`px-2 py-1 rounded ${minVolume === value ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>{value === 0 ? 'ALL' : usd.format(value)}</button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-text-muted">
          DEX:
          <select value={filterDex} onChange={event => setFilterDex(event.target.value)} className="bg-bg-panel border border-border-dim rounded px-2 py-1 text-text-secondary">
            {dexes.map(value => <option key={value} value={value}>{value === 'all' ? 'ALL' : value}</option>)}
          </select>
        </label>
      </div>

      <Panel title="Trending DEX Pools" subtitle={`${filteredPools.length} pools · ${network} · 24h metrics`} liveStatus={status} maxHeight={700}>
        <DataTable columns={columns} data={filteredPools} rowHeight={32} sortable filterable filterPlaceholder="Filter pools…" emptyState={<div className="text-text-muted text-xs p-4">No pools match the filters, or upstream pool data is unavailable.</div>} />
      </Panel>
    </div>
  )
}
