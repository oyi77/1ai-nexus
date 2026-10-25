"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { formatCompact } from '@/lib/format'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface ExchangeFlowData {
  exchange: string
  inflow: number
  outflow: number
  netFlow: number
  volume24h: number
  avgPriceChange: number
  signal: string
  topSymbols: string[]
}

interface FlowPayload {
  timestamp: number
  flows: ExchangeFlowData[]
  totalInflow: number
  totalOutflow: number
  totalNetFlow: number
  signal: string
}

interface ExchangeTicker {
  symbol: string
  price: string
  change: string
  [k: string]: unknown
}

type ExchangeData = Record<string, ExchangeTicker[]>

interface Flow {
  chain: string
  inflow: number | null
  outflow: number | null
  net: number | null
  netFlow: number
  signal: string
  topSymbols: string[]
  [k: string]: unknown
}

export default function FlowsPage() {
  const { status, refresh } = useLiveFetch<ExchangeData>({ url: '/api/v1/exchanges?limit=10', interval: 60_000 })
  const { data: flowPayload } = useLiveFetch<FlowPayload>({ url: '/api/v1/exchange-flow', interval: 60_000 })

  const flows: Flow[] = (() => {
    const result: Flow[] = []
    const flowEvents = flowPayload?.flows || []

    for (const ev of flowEvents) {
      const ex = ev.exchange
      if (!ex) continue
      result.push({
        chain: ex.charAt(0).toUpperCase() + ex.slice(1),
        inflow: ev.inflow,
        outflow: ev.outflow,
        net: ev.netFlow,
        netFlow: ev.netFlow,
        signal: ev.signal,
        topSymbols: ev.topSymbols || [],
      })
    }
    return result
  })()

  const columns: Column<Flow>[] = [
    { key: 'chain', header: 'Exchange', width: 100, render: r => <span className="text-teal-vivid font-bold uppercase">{r.chain}</span> },
    { key: 'inflow', header: 'Sell-Pressure Proxy', width: 120, align: 'right', render: r => r.inflow != null ? <span className="font-mono text-xs">${formatCompact(r.inflow)}</span> : <span className="text-text-muted text-xs font-mono">—</span> },
    { key: 'outflow', header: 'Buy-Pressure Proxy', width: 120, align: 'right', render: r => r.outflow != null ? <span className="font-mono text-xs">${formatCompact(r.outflow)}</span> : <span className="text-text-muted text-xs font-mono">—</span> },
    { key: 'net', header: 'Pressure Balance', width: 110, align: 'right', render: r => r.net != null ? <span className={`font-mono font-bold ${r.net > 0 ? 'text-data-bear' : 'text-data-bull'}`}>{r.net > 0 ? '+' : ''}${formatCompact(r.net)}</span> : <span className="text-text-muted text-xs font-mono">—</span> },
    { key: 'signal', header: 'Momentum', width: 90, render: r => <span className={`text-xs font-mono font-bold ${r.signal === 'bullish' ? 'text-data-bull' : r.signal === 'bearish' ? 'text-data-bear' : 'text-text-muted'}`}>{r.signal === 'bullish' ? 'RISING' : r.signal === 'bearish' ? 'FALLING' : 'NEUTRAL'}</span> },
    { key: 'topSymbols', header: 'Top Pairs', width: 200, render: r => <span className="text-xs text-text-muted font-mono truncate">{r.topSymbols.slice(0, 3).join(', ')}</span> },
  ]

  const totalInflow = flowPayload?.totalInflow ?? 0
  const totalOutflow = flowPayload?.totalOutflow ?? 0
  const totalNet = flowPayload?.totalNetFlow ?? 0
  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Exchange Volume &amp; Momentum Proxy</h1>
            <p className="text-xs text-text-muted">Ticker volume/price heuristics — not measured deposits, withdrawals, or whale transfers</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <div className="grid grid-cols-3 gap-1">
          {[
            { label: 'Sell-Pressure Proxy', value: `$${formatCompact(totalInflow)}`, color: 'text-data-bear' },
            { label: 'Buy-Pressure Proxy', value: `$${formatCompact(totalOutflow)}`, color: 'text-data-bull' },
            { label: 'Pressure Balance', value: `${totalNet > 0 ? '+' : ''}$${formatCompact(totalNet)}`, color: totalNet > 0 ? 'text-data-bear' : 'text-data-bull' },
          ].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-xs text-text-muted font-mono uppercase mb-1">{k.label}</div>
              <div className={`text-[16px] font-head font-bold tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        <Panel title="Exchange Pressure Proxies" subtitle={`${flows.length} exchanges · heuristic only`} liveStatus={status} onRefresh={refresh} maxHeight={600}>
          <DataTable columns={columns as unknown as Column<Record<string, unknown>>[]} data={flows as unknown as Record<string, unknown>[]} sortable filterable filterPlaceholder="Filter flows…" rowHeight={32} emptyState={<div className="text-text-muted text-xs p-4">Loading exchange flow data...</div>} />
        </Panel>
      </div>
    </NexusLayout>
  )
}
