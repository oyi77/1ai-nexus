"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface FlowEvent {
  exchange: string
  type: 'deposit' | 'withdrawal'
  token: string
  amountUsd: number
  timestamp: string
  [k: string]: unknown
}

interface FlowResponse { data: FlowEvent[] }

export default function ExchangeFlowPage() {
  const { data, status, refresh } = useLiveFetch<FlowResponse>({ url: '/api/v1/exchange-flow', interval: 60_000 })
  const flows = data?.data || []

  const columns: Column<FlowEvent>[] = [
    { key: 'exchange', header: 'Exchange', width: 80, render: r => <span className="text-teal-vivid font-bold">{r.exchange}</span> },
    { key: 'type', header: 'Type', width: 80, render: r => (
      <span className={`text-[10px] font-mono ${r.type === 'deposit' ? 'text-data-bear' : 'text-data-bull'}`}>
        {r.type === 'deposit' ? '↓ DEPOSIT' : '↑ WITHDRAWAL'}
      </span>
    )},
    { key: 'token', header: 'Token', width: 60, render: r => <span className="text-text-primary">{r.token}</span> },
    { key: 'amountUsd', header: 'Amount', width: 100, align: 'right', render: r => <PriceTag value={r.amountUsd} size="sm" /> },
    { key: 'timestamp', header: 'Time', width: 80, align: 'right', render: r => <span className="text-text-muted text-[10px]">{r.timestamp}</span> },
  ]

  const totalDeposit = flows.filter(f => f.type === 'deposit').reduce((s, f) => s + f.amountUsd, 0)
  const totalWithdraw = flows.filter(f => f.type === 'withdrawal').reduce((s, f) => s + f.amountUsd, 0)
  const netFlow = totalWithdraw - totalDeposit

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">💰 Exchange Flow</h1>
            <p className="text-[11px] text-text-muted font-mono">Whale deposits/withdrawals to CEX — leading indicator for selling pressure</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <div className="grid grid-cols-3 gap-1">
          {[
            { label: 'Deposits 24h', value: `$${(totalDeposit / 1e6).toFixed(1)}M`, color: 'text-data-bear', note: 'Bearish — selling pressure' },
            { label: 'Withdrawals 24h', value: `$${(totalWithdraw / 1e6).toFixed(1)}M`, color: 'text-data-bull', note: 'Bullish — holding' },
            { label: 'Net Flow', value: `${netFlow > 0 ? '+' : ''}$${(netFlow / 1e6).toFixed(1)}M`, color: netFlow > 0 ? 'text-data-bull' : 'text-data-bear', note: netFlow > 0 ? 'Net outflow' : 'Net inflow' },
          ].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{k.label}</div>
              <div className={`text-[16px] font-head font-bold tabular-nums ${k.color}`}>{k.value}</div>
              <div className="text-[9px] text-text-muted mt-0.5">{k.note}</div>
            </div>
          ))}
        </div>

        <Panel title="Exchange Flows" subtitle="Large deposits/withdrawals" liveStatus={status} onRefresh={refresh} maxHeight={500}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={flows as unknown as Record<string, unknown>[]}
            rowHeight={28}
            emptyState={<div className="text-text-muted text-[11px] p-4">No large exchange flows detected</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
