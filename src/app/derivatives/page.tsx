"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { Sparkline } from '@/components/primitives/Sparkline'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface DerivativesResponse { topPairs: Array<Record<string, unknown>> }
type HyperliquidResponse = Array<Record<string, unknown>>

interface Pair { symbol: string; price: number; change24h: number; volume24h: number; openInterest: number; fundingRate: number; high24h: number; low24h: number; sparkline: number[]; [k: string]: unknown }

export default function DerivativesPage() {
  const { data: deriv, status } = useLiveFetch<DerivativesResponse>({ url: '/api/v1/derivatives?limit=50', interval: 15_000 })
  const { data: hl } = useLiveFetch<HyperliquidResponse>({ url: '/api/v1/hyperliquid?limit=50', interval: 15_000 })
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'volume' | 'oi' | 'funding'>('volume')

  const pairs: Pair[] = (() => {
    const map = new Map<string, Pair>()
    for (const p of deriv?.topPairs || []) {
      map.set(p.symbol as string, { symbol: p.symbol as string, price: p.price as number, change24h: p.priceChange24h as number, volume24h: p.quoteVolume24h as number, openInterest: p.openInterest as number, fundingRate: p.fundingRate as number, high24h: p.high24h as number, low24h: p.low24h as number, sparkline: [] })
    }
    for (const p of (hl || []).slice(0, 30)) {
      const sym = p.symbol as string
      if (!map.has(sym) && !sym.startsWith('@')) map.set(sym, { symbol: sym, price: p.price as number, change24h: 0, volume24h: 0, openInterest: 0, fundingRate: 0, high24h: 0, low24h: 0, sparkline: [] })
    }
    return Array.from(map.values())
  })()

  const filtered = pairs.filter(p => !search || p.symbol.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sortBy === 'volume' ? b.volume24h - a.volume24h : sortBy === 'oi' ? b.openInterest - a.openInterest : Math.abs(b.fundingRate) - Math.abs(a.fundingRate))

  const columns: Column<Pair>[] = [
    { key: 'symbol', header: 'Pair', width: 100, render: r => <span className="text-teal-vivid font-bold">{r.symbol}</span> },
    { key: 'price', header: 'Price', width: 100, align: 'right', render: r => <PriceTag value={r.price} size="sm" /> },
    { key: 'change24h', header: '24h%', width: 70, align: 'right', render: r => <DeltaBadge value={r.change24h} size="xs" /> },
    { key: 'volume24h', header: 'Volume', width: 100, align: 'right', render: r => <span className="text-text-secondary">${(r.volume24h / 1e6).toFixed(1)}M</span> },
    { key: 'openInterest', header: 'OI', width: 100, align: 'right', render: r => <span className="text-text-primary">{r.openInterest > 0 ? r.openInterest.toLocaleString() : '—'}</span> },
    { key: 'fundingRate', header: 'Funding', width: 70, align: 'right', render: r => <span className={`font-mono ${r.fundingRate > 0 ? 'text-data-bull' : r.fundingRate < 0 ? 'text-data-bear' : 'text-text-muted'}`}>{r.fundingRate !== 0 ? `${(r.fundingRate * 100).toFixed(4)}%` : '—'}</span> },
    { key: 'high24h', header: 'High', width: 80, align: 'right', render: r => <span className="text-data-bull text-[10px]">{r.high24h > 0 ? `$${r.high24h.toLocaleString()}` : '—'}</span> },
    { key: 'low24h', header: 'Low', width: 80, align: 'right', render: r => <span className="text-data-bear text-[10px]">{r.low24h > 0 ? `$${r.low24h.toLocaleString()}` : '—'}</span> },
    { key: 'sparkline', header: '24h', width: 60, render: r => <Sparkline data={r.sparkline} width={50} height={16} /> },
  ]

  const totalVol = pairs.reduce((s, p) => s + p.volume24h, 0)
  const avgFund = pairs.length > 0 ? pairs.reduce((s, p) => s + p.fundingRate, 0) / pairs.length : 0

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div><h1 className="text-[20px] font-head font-bold text-text-primary">Derivatives Dashboard</h1><p className="text-[11px] text-text-muted font-mono">Binance Futures + Hyperliquid — funding, OI, liquidations</p></div>
          <LiveDot status={status} label />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
          {[{ l: 'Volume 24h', v: `$${(totalVol / 1e9).toFixed(2)}B` }, { l: 'Pairs', v: String(pairs.length) }, { l: 'Avg Funding', v: `${(avgFund * 100).toFixed(4)}%` }, { l: 'Sources', v: 'Binance + Hyperliquid' }].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2"><div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">{k.l}</div><div className="text-[16px] font-head font-bold text-text-primary tabular-nums">{k.v}</div></div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="text" placeholder="Search pair..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="bg-bg-panel border border-bg-border rounded px-3 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted outline-none w-48" />
          <div className="flex items-center gap-1 text-[10px] font-mono">
            {(['volume', 'oi', 'funding'] as const).map(s => <button key={s} onClick={() => setSortBy(s)} className={`px-2 py-1 rounded ${sortBy === s ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>{s === 'oi' ? 'OI' : s.toUpperCase()}</button>)}
          </div>
          <span className="ml-auto text-[10px] text-text-muted font-mono">{filtered.length} pairs</span>
        </div>
        <Panel title="Perpetual Contracts" subtitle="Real-time derivatives" liveStatus={status} maxHeight={600}>
          <DataTable columns={columns} data={filtered} sortable rowHeight={28} emptyState={<div className="text-text-muted text-[11px] p-4">Loading...</div>} />
        </Panel>
      </div>
    </NexusLayout>
  )
}
