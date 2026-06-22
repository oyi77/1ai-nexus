"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
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
    { key: 'inflow', header: 'Inflow', width: 100, align: 'right', render: r => r.inflow != null ? <PriceTag value={r.inflow} size="sm" /> : <span className="text-text-muted text-[11px] font-mono">—</span> },
    { key: 'outflow', header: 'Outflow', width: 100, align: 'right', render: r => r.outflow != null ? <PriceTag value={r.outflow} size="sm" /> : <span className="text-text-muted text-[11px] font-mono">—</span> },
    { key: 'net', header: 'Net Flow', width: 100, align: 'right', render: r => r.net != null ? <span className={`font-mono font-bold ${r.net > 0 ? 'text-data-bear' : 'text-data-bull'}`}>{r.net > 0 ? '+' : ''}${(r.net / 1e6).toFixed(2)}M</span> : <span className="text-text-muted text-[11px] font-mono">—</span> },
    { key: 'signal', header: 'Signal', width: 70, render: r => <span className={`text-[10px] font-mono font-bold ${r.signal === 'bullish' ? 'text-data-bull' : 'text-data-bear'}`}>{r.signal === 'bullish' ? '🟢 BULL' : '🔴 BEAR'}</span> },
    { key: 'topSymbols', header: 'Top Pairs', width: 200, render: r => <span className="text-[10px] text-text-muted font-mono truncate">{r.topSymbols.slice(0, 3).join(', ')}</span> },
  ]

  const totalInflow = flowPayload?.totalInflow ?? 0
  const totalOutflow = flowPayload?.totalOutflow ?? 0
  const totalNet = flowPayload?.totalNetFlow ?? 0

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Exchange Flows</h1>
            <p className="text-[11px] text-text-muted font-mono">CEX deposit/withdrawal flows — whale activity indicator</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <div className="grid grid-cols-3 gap-1">
          {[
            { label: 'Total Inflow', value: `$${(totalInflow / 1e9).toFixed(2)}B`, color: 'text-data-bear' },
            { label: 'Total Outflow', value: `$${(totalOutflow / 1e9).toFixed(2)}B`, color: 'text-data-bull' },
            { label: 'Net Flow', value: `${totalNet > 0 ? '+' : ''}$${(totalNet / 1e6).toFixed(0)}M`, color: totalNet > 0 ? 'text-data-bear' : 'text-data-bull' },
          ].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{k.label}</div>
              <div className={`text-[16px] font-head font-bold tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        <Panel title="Exchange Flows" subtitle={`${flows.length} exchanges`} liveStatus={status} onRefresh={refresh} maxHeight={600}>
          <DataTable columns={columns as unknown as Column<Record<string, unknown>>[]} data={flows as unknown as Record<string, unknown>[]} sortable rowHeight={32} emptyState={<div className="text-text-muted text-[11px] p-4">Loading exchange flow data...</div>} />
        </Panel>
      </div>
    </NexusLayout>
  )
}
