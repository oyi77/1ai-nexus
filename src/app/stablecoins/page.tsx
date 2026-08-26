"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface Stablecoin {
  id?: string
  name: string
  symbol: string
  price: number
  marketCap: number
  change24h: number
  deviation: number
  pegStatus?: string
  volume24h?: number
  chains?: string[]
  [k: string]: unknown
}

interface StablecoinsResponse {
  stablecoins: Stablecoin[]
  summary?: Record<string, unknown>
}


function fmtVol(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

export default function StablecoinsPage() {
  const { data: resp, status, refresh } = useLiveFetch<StablecoinsResponse>({
    url: '/api/v1/stablecoins',
    interval: 60_000,
  })

  // Hook auto-unwraps { data, error } envelope → resp = { stablecoins, summary }
  const stablecoins: Stablecoin[] = resp?.stablecoins || []

  const columns: Column<Stablecoin>[] = [
    { key: 'symbol', header: 'Token', width: 80, render: r => <span className="text-teal-vivid font-bold">{r.symbol}</span> },
    { key: 'price', header: 'Price', width: 90, align: 'right', render: r => <span className={`font-mono ${Math.abs((r.price ?? 0) - 1) > 0.005 ? 'text-data-bear' : 'text-data-bull'}`}>${(r.price ?? 0).toFixed(4)}</span> },
    { key: 'deviation', header: 'Peg Dev', width: 70, align: 'right', render: r => <span className={`font-mono ${(r.deviation ?? 0) > 0.5 ? 'text-data-bear' : 'text-data-bull'}`}>{(r.deviation ?? 0).toFixed(3)}%</span> },
    { key: 'pegStatus', header: 'Status', width: 70, render: r => <span className={`text-xs font-mono font-bold ${r.pegStatus === 'ON PEG' ? 'text-data-bull' : 'text-data-bear'}`}>{r.pegStatus ?? '—'}</span> },
    { key: 'marketCap', header: 'MCap', width: 100, align: 'right', render: r => <PriceTag value={r.marketCap ?? 0} size="sm" /> },
    { key: 'volume24h', header: 'Vol 24h', width: 90, align: 'right', render: r => <span className="text-text-muted font-mono text-xs">{r.volume24h ? fmtVol(r.volume24h) : '—'}</span> },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div><h1 className="text-[20px] font-head font-bold text-text-primary">Stablecoins</h1><p className="text-xs text-text-muted">Peg stability and market data</p></div>
          <LiveDot status={status} label />
        </div>
        {status === 'error' && <div className="text-data-bear text-xs font-mono p-4">Error: Failed to fetch stablecoin data</div>}
        <Panel title="Stablecoin Monitor" subtitle={`${stablecoins.length} tracked`} liveStatus={status} onRefresh={refresh} maxHeight={600}>
          <DataTable columns={columns as unknown as Column<Record<string, unknown>>[]} data={stablecoins as unknown as Record<string, unknown>[]} sortable filterable filterPlaceholder="Filter stablecoins…" rowHeight={28} emptyState={<div className="text-text-muted text-xs p-4">Loading...</div>} />
        </Panel>
      </div>
    </NexusLayout>
  )
}
