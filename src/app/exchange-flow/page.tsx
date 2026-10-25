"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface ExchangeFlow {
  exchange: string
  inflow: number
  outflow: number
  netFlow: number
  volume24h: number
  avgPriceChange: number
  signal: string
  topSymbols: string[]
  [k: string]: unknown
}
interface WhaleEvent {
  id: string
  exchange: string
  symbol: string
  estimatedValue: number
  direction: string
  priceChange: number
  volume24h: number
  confidence: number
  timestamp: number
}
interface FlowPayload {
  timestamp: number
  flows: ExchangeFlow[]
  totalInflow: number
  totalOutflow: number
  totalNetFlow: number
  signal: string
  whaleEvents: WhaleEvent[]
  sparkHistory: number[]
}
export function fmtUsd(n: number | null | undefined): string {
  if (!Number.isFinite(n)) return '—'
  const value = n as number
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function fmtPercent(n: number | null | undefined): string {
  return Number.isFinite(n) ? `${(n as number) >= 0 ? '+' : ''}${(n as number).toFixed(2)}%` : '—'
}
export default function ExchangeFlowPage() {
  const { data, status, refresh } = useLiveFetch<FlowPayload>({ url: '/api/v1/exchange-flow', interval: 60_000 })
  const flows = data?.flows ?? []
  const highVolumeSymbols = data?.whaleEvents ?? []
  const columns: Column<ExchangeFlow>[] = [
    { key: 'exchange', header: 'Exchange', width: 80, render: r => <span className="text-teal-vivid font-bold uppercase">{r.exchange}</span> },
    { key: 'inflow', header: 'Sell-Pressure Proxy', width: 120, align: 'right', sortable: true, render: r => <span className="text-data-bear tabular-nums">{fmtUsd(r.inflow)}</span> },
    { key: 'outflow', header: 'Buy-Pressure Proxy', width: 120, align: 'right', sortable: true, render: r => <span className="text-data-bull tabular-nums">{fmtUsd(r.outflow)}</span> },
    { key: 'netFlow', header: 'Pressure Balance', width: 120, align: 'right', sortable: true, render: r => <span className="font-bold tabular-nums">{fmtUsd(r.netFlow)}</span> },
    { key: 'volume24h', header: 'Volume 24h', width: 100, align: 'right', sortable: true, render: r => <span className="text-text-primary tabular-nums">{fmtUsd(r.volume24h)}</span> },
    { key: 'avgPriceChange', header: 'Avg Δ%', width: 70, align: 'right', sortable: true, render: r => <span className={Number.isFinite(r.avgPriceChange) ? r.avgPriceChange >= 0 ? 'text-data-bull' : 'text-data-bear' : 'text-text-muted'}>{fmtPercent(r.avgPriceChange)}</span> },
    { key: 'signal', header: 'Momentum', width: 80, render: r => <span className={`text-xs font-mono font-bold ${r.signal === 'bullish' ? 'text-data-bull' : r.signal === 'bearish' ? 'text-data-bear' : 'text-text-muted'}`}>{r.signal === 'bullish' ? 'RISING' : r.signal === 'bearish' ? 'FALLING' : 'NEUTRAL'}</span> },
    { key: 'topSymbols', header: 'Top Pairs', width: 200, render: r => <span className="text-xs text-text-muted font-mono truncate">{(r.topSymbols ?? []).slice(0, 3).join(', ')}</span> },
  ]
  const volumeColumns: Column<WhaleEvent>[] = [
    { key: 'exchange', header: 'Exchange', width: 70, render: r => <span className="text-teal-vivid font-bold uppercase">{r.exchange}</span> },
    { key: 'symbol', header: 'Pair', width: 90, render: r => <span className="text-text-primary font-mono">{r.symbol}</span> },
    { key: 'direction', header: 'Price Move', width: 80, render: r => <span className={`text-xs font-mono ${r.direction === 'deposit' ? 'text-data-bear' : 'text-data-bull'}`}>{r.direction === 'deposit' ? '↓ DOWN' : '↑ UP'}</span> },
    { key: 'estimatedValue', header: 'Volume 24h', width: 100, align: 'right', sortable: true, render: r => <span className="font-bold tabular-nums text-text-primary">{fmtUsd(r.estimatedValue)}</span> },
    { key: 'priceChange', header: 'Price Δ%', width: 70, align: 'right', render: r => <span className={Number.isFinite(r.priceChange) ? r.priceChange >= 0 ? 'text-data-bull' : 'text-data-bear' : 'text-text-muted'}>{fmtPercent(r.priceChange)}</span> },
    { key: 'confidence', header: 'Proxy Strength', width: 90, align: 'right', render: r => <span className="text-xs tabular-nums text-text-muted">{Number.isFinite(r.confidence) ? `${Math.round(r.confidence * 100)}%` : '—'}</span> },
  ]
  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Exchange Volume & Momentum Proxy</h1>
            <p className="text-xs text-text-muted">Ticker volume/price heuristics — not on-chain deposits, withdrawals, or whale transfers</p>
          </div>
          <LiveDot status={status} label />
        </div>
        <div className="grid grid-cols-4 gap-1">
          {[
            { label: 'Sell-Pressure Proxy', value: data ? fmtUsd(data.totalInflow) : '—', note: 'Estimated from ticker volume and falling prices' },
            { label: 'Buy-Pressure Proxy', value: data ? fmtUsd(data.totalOutflow) : '—', note: 'Estimated from ticker volume and rising prices' },
            { label: 'Pressure Balance', value: data ? fmtUsd(data.totalNetFlow) : '—', note: 'Sell-pressure proxy minus buy-pressure proxy' },
            { label: 'Momentum', value: data ? data.signal.toUpperCase() : 'UNAVAILABLE', note: `${flows.length} exchanges · heuristic only` },
          ].map(k => <div key={k.label} className="bg-bg-panel border border-bg-border px-3 py-2"><div className="text-xs text-text-muted font-mono uppercase mb-1">{k.label}</div><div className="text-[16px] font-head font-bold tabular-nums">{k.value}</div><div className="text-xs text-text-muted mt-0.5">{k.note}</div></div>)}
        </div>
        <Panel title="Exchange Pressure Proxies" subtitle={`${flows.length} exchanges · not measured asset flows`} liveStatus={status} onRefresh={refresh} maxHeight={500}>
          <DataTable columns={columns as unknown as Column<Record<string, unknown>>[]} data={flows as unknown as Record<string, unknown>[]} sortable filterable filterPlaceholder="Filter exchanges…" rowHeight={32} emptyState={<div className="text-text-muted text-xs p-4">No ticker data available</div>} />
        </Panel>
        <Panel title="High-Volume Symbols" subtitle={`${highVolumeSymbols.length} symbols above the volume threshold`} liveStatus={status} onRefresh={refresh} maxHeight={400}>
          <DataTable columns={volumeColumns as unknown as Column<Record<string, unknown>>[]} data={highVolumeSymbols as unknown as Record<string, unknown>[]} sortable filterable filterPlaceholder="Filter high-volume symbols…" rowHeight={28} emptyState={<div className="text-text-muted text-xs p-4">No high-volume symbols detected</div>} />
        </Panel>
      </div>
    </NexusLayout>
  )
}
