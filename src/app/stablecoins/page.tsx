"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface Stablecoin { name: string; symbol: string; price: number; marketCap: number; change24h: number; chains: string[]; peg_deviation: number; [k: string]: unknown }
interface StablecoinsResponse { data?: Stablecoin[] }

const FALLBACK: Stablecoin[] = [
  { name: 'Tether', symbol: 'USDT', price: 1.0001, marketCap: 110e9, change24h: 0.01, chains: ['Ethereum', 'Tron', 'Solana'], peg_deviation: 0.01 },
  { name: 'USD Coin', symbol: 'USDC', price: 0.9999, marketCap: 32e9, change24h: -0.01, chains: ['Ethereum', 'Solana', 'Base'], peg_deviation: 0.01 },
  { name: 'Dai', symbol: 'DAI', price: 1.0002, marketCap: 5e9, change24h: 0.02, chains: ['Ethereum'], peg_deviation: 0.02 },
  { name: 'Ethena USDe', symbol: 'USDe', price: 1.0003, marketCap: 2.5e9, change24h: 0.03, chains: ['Ethereum'], peg_deviation: 0.03 },
]

export default function StablecoinsPage() {
  const { data: resp, status, refresh } = useLiveFetch<StablecoinsResponse>({ url: '/api/v1/stablecoins', interval: 60_000 })
  const stablecoins = resp?.data || FALLBACK

  const columns: Column<Stablecoin>[] = [
    { key: 'symbol', header: 'Token', width: 80, render: r => <span className="text-teal-vivid font-bold">{r.symbol}</span> },
    { key: 'price', header: 'Price', width: 80, align: 'right', render: r => <span className={`font-mono ${Math.abs(r.price - 1) > 0.005 ? 'text-data-bear' : 'text-data-bull'}`}>${r.price.toFixed(4)}</span> },
    { key: 'peg_deviation', header: 'Peg Dev', width: 70, align: 'right', render: r => <span className={`font-mono ${r.peg_deviation > 0.5 ? 'text-data-bear' : 'text-data-bull'}`}>{r.peg_deviation.toFixed(3)}%</span> },
    { key: 'marketCap', header: 'MCap', width: 100, align: 'right', render: r => <PriceTag value={r.marketCap} size="sm" /> },
    { key: 'chains', header: 'Chains', width: 150, render: r => <div className="flex flex-wrap gap-1">{r.chains.slice(0, 3).map((c, i) => <span key={i} className="px-1 py-0 rounded bg-bg-raised text-[9px] font-mono text-text-muted">{c}</span>)}</div> },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div><h1 className="text-[20px] font-head font-bold text-text-primary">Stablecoins</h1><p className="text-[11px] text-text-muted font-mono">Peg stability and market data</p></div>
          <LiveDot status={status} label />
        </div>
        {status === 'error' && <div className="text-data-bear text-[11px] font-mono p-4">Error: Failed to fetch stablecoin data</div>}
        <Panel title="Stablecoin Monitor" subtitle={`${stablecoins.length} tracked`} liveStatus={status} onRefresh={refresh} maxHeight={600}>
          <DataTable columns={columns} data={stablecoins} sortable rowHeight={28} emptyState={<div className="text-text-muted text-[11px] p-4">Loading...</div>} />
        </Panel>
      </div>
    </NexusLayout>
  )
}
