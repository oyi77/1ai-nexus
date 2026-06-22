"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface MarketResponse { tickers: Array<{ symbol: string; price: string; change: string; positive: boolean }> }
interface MacroResponse { indicators: Array<{ id: string; name: string; latestValue: number; changePercent: number }> }
interface Asset { name: string; symbol: string; price: number; change: number; category: string; [k: string]: unknown }

export default function ComparePage() {
  const { data: market, status } = useLiveFetch<MarketResponse>({ url: '/api/v1/market/prices', interval: 60_000 })
  const { data: macro } = useLiveFetch<MacroResponse>({ url: '/api/v1/macro', interval: 300_000 })

  const assets: Asset[] = [
    ...(market?.tickers || []).map(t => ({ name: t.symbol, symbol: t.symbol, price: parseFloat((t.price || '0').replace(/[$,]/g, '')), change: parseFloat((t.change || '0').replace(/%+/g, '')), category: ['BTC', 'ETH', 'SOL'].includes(t.symbol) ? 'Crypto' : 'Traditional' })),
    ...(macro?.indicators || []).map(i => ({ name: i.name, symbol: i.id, price: i.latestValue, change: i.changePercent || 0, category: 'Macro' })),
  ]

  const columns: Column<Asset>[] = [
    { key: 'category', header: 'Cat', width: 60, render: r => <span className={`text-[10px] font-mono ${r.category === 'Crypto' ? 'text-teal-vivid' : r.category === 'Macro' ? 'text-data-purple' : 'text-data-info'}`}>{r.category}</span> },
    { key: 'name', header: 'Asset', width: 150, render: r => <span className="text-text-primary font-medium">{r.name}</span> },
    { key: 'price', header: 'Value', width: 100, align: 'right', render: r => <PriceTag value={r.price} size="sm" /> },
    { key: 'change', header: 'Change', width: 70, align: 'right', render: r => <DeltaBadge value={r.change} size="xs" /> },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div><h1 className="text-[20px] font-head font-bold text-text-primary">Cross-Market</h1><p className="text-[11px] text-text-muted font-mono">Crypto, forex, commodities, macro</p></div>
          <LiveDot status={status} label />
        </div>
        <Panel title="Market Overview" subtitle={`${assets.length} assets`} liveStatus={status} maxHeight={600}>
          <DataTable columns={columns} data={assets} sortable rowHeight={28} emptyState={<div className="text-text-muted text-[11px] p-4">Loading...</div>} />
        </Panel>
      </div>
    </NexusLayout>
  )
}
