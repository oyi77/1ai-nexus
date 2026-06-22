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

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export default function ExchangeFlowPage() {
  const { data, status, refresh } = useLiveFetch<FlowPayload>({
    url: '/api/v1/exchange-flow',
    interval: 60_000,
  })

  const flows: ExchangeFlow[] = data?.flows ?? []
  const whaleEvents: WhaleEvent[] = data?.whaleEvents ?? []
  const totalInflow = data?.totalInflow ?? 0
  const totalOutflow = data?.totalOutflow ?? 0
  const totalNetFlow = data?.totalNetFlow ?? 0
  const signal = data?.signal ?? 'neutral'

  const columns: Column<ExchangeFlow>[] = [
    {
      key: 'exchange',
      header: 'Exchange',
      width: 80,
      render: r => <span className="text-teal-vivid font-bold uppercase">{r.exchange}</span>,
    },
    {
      key: 'inflow',
      header: 'Inflow',
      width: 100,
      align: 'right',
      sortable: true,
      render: r => <span className="text-data-bear tabular-nums">{fmtUsd(r.inflow)}</span>,
    },
    {
      key: 'outflow',
      header: 'Outflow',
      width: 100,
      align: 'right',
      sortable: true,
      render: r => <span className="text-data-bull tabular-nums">{fmtUsd(r.outflow)}</span>,
    },
    {
      key: 'netFlow',
      header: 'Net Flow',
      width: 100,
      align: 'right',
      sortable: true,
      render: r => (
        <span className={`font-bold tabular-nums ${r.netFlow > 0 ? 'text-data-bear' : 'text-data-bull'}`}>
          {r.netFlow > 0 ? '+' : ''}{fmtUsd(r.netFlow)}
        </span>
      ),
    },
    {
      key: 'volume24h',
      header: 'Volume 24h',
      width: 100,
      align: 'right',
      sortable: true,
      render: r => <span className="text-text-primary tabular-nums">{fmtUsd(r.volume24h)}</span>,
    },
    {
      key: 'avgPriceChange',
      header: 'Avg Δ%',
      width: 70,
      align: 'right',
      sortable: true,
      render: r => (
        <span className={`tabular-nums ${r.avgPriceChange >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
          {r.avgPriceChange >= 0 ? '+' : ''}{r.avgPriceChange.toFixed(2)}%
        </span>
      ),
    },
    {
      key: 'signal',
      header: 'Signal',
      width: 70,
      render: r => (
        <span className={`text-[10px] font-mono font-bold ${r.signal === 'bullish' ? 'text-data-bull' : 'text-data-bear'}`}>
          {r.signal === 'bullish' ? '🟢 BULL' : '🔴 BEAR'}
        </span>
      ),
    },
    {
      key: 'topSymbols',
      header: 'Top Pairs',
      width: 200,
      render: r => (
        <span className="text-[10px] text-text-muted font-mono truncate">
          {(r.topSymbols ?? []).slice(0, 3).join(', ')}
        </span>
      ),
    },
  ]

  const whaleColumns: Column<WhaleEvent>[] = [
    {
      key: 'exchange',
      header: 'Exchange',
      width: 70,
      render: r => <span className="text-teal-vivid font-bold uppercase">{r.exchange}</span>,
    },
    {
      key: 'symbol',
      header: 'Pair',
      width: 90,
      render: r => <span className="text-text-primary font-mono">{r.symbol}</span>,
    },
    {
      key: 'direction',
      header: 'Direction',
      width: 80,
      render: r => (
        <span className={`text-[10px] font-mono ${r.direction === 'deposit' ? 'text-data-bear' : 'text-data-bull'}`}>
          {r.direction === 'deposit' ? '↓ DEPOSIT' : '↑ WITHDRAWAL'}
        </span>
      ),
    },
    {
      key: 'estimatedValue',
      header: 'Value',
      width: 100,
      align: 'right',
      sortable: true,
      render: r => <span className="font-bold tabular-nums text-text-primary">{fmtUsd(r.estimatedValue)}</span>,
    },
    {
      key: 'priceChange',
      header: 'Price Δ%',
      width: 70,
      align: 'right',
      render: r => (
        <span className={`tabular-nums ${r.priceChange >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
          {r.priceChange >= 0 ? '+' : ''}{r.priceChange.toFixed(2)}%
        </span>
      ),
    },
    {
      key: 'confidence',
      header: 'Conf',
      width: 50,
      align: 'right',
      render: r => (
        <span className="text-[10px] tabular-nums text-text-muted">
          {Math.round(r.confidence * 100)}%
        </span>
      ),
    },
  ]

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

        <div className="grid grid-cols-4 gap-1">
          {[
            { label: 'Total Inflow', value: fmtUsd(totalInflow), color: 'text-data-bear', note: 'Deposits — selling pressure' },
            { label: 'Total Outflow', value: fmtUsd(totalOutflow), color: 'text-data-bull', note: 'Withdrawals — holding' },
            { label: 'Net Flow', value: `${totalNetFlow > 0 ? '+' : ''}${fmtUsd(totalNetFlow)}`, color: totalNetFlow > 0 ? 'text-data-bear' : 'text-data-bull', note: totalNetFlow > 0 ? 'Net inflow (bearish)' : 'Net outflow (bullish)' },
            { label: 'Signal', value: signal.toUpperCase(), color: signal === 'bullish' ? 'text-data-bull' : signal === 'bearish' ? 'text-data-bear' : 'text-text-muted', note: `${flows.length} exchanges tracked` },
          ].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{k.label}</div>
              <div className={`text-[16px] font-head font-bold tabular-nums ${k.color}`}>{k.value}</div>
              <div className="text-[9px] text-text-muted mt-0.5">{k.note}</div>
            </div>
          ))}
        </div>

        <Panel title="Exchange Flows" subtitle={`${flows.length} exchanges · signal: ${signal}`} liveStatus={status} onRefresh={refresh} maxHeight={500}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={flows as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={32}
            emptyState={<div className="text-text-muted text-[11px] p-4">No exchange flow data available</div>}
          />
        </Panel>

        <Panel title="Whale Events" subtitle={`${whaleEvents.length} large movements detected`} liveStatus={status} onRefresh={refresh} maxHeight={400}>
          <DataTable
            columns={whaleColumns as unknown as Column<Record<string, unknown>>[]}
            data={whaleEvents as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={28}
            emptyState={<div className="text-text-muted text-[11px] p-4">No whale events detected</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
