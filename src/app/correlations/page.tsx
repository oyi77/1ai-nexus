"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { LiveDot } from '@/components/primitives/LiveDot'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface CorrelationData {
  pair: string
  assetA: string
  assetB: string
  correlation: number
  pValue: number
  sampleSize: number
  lag: number
  significance: string
  description: string
}

interface CorrelationResponse { data: CorrelationData[] }

export default function CorrelationsPage() {
  const { data, status, refresh } = useLiveFetch<CorrelationResponse>({ url: '/api/v1/correlations', interval: 60_000 })
  const correlations = data?.data || []

  const columns: Column<CorrelationData>[] = [
    { key: 'pair', header: 'Pair', width: 150, render: r => <span className="text-teal-vivid font-bold">{r.pair}</span> },
    { key: 'correlation', header: 'Correlation', width: 100, align: 'right', render: r => (
      <span className={`font-mono font-bold ${r.correlation > 0.5 ? 'text-data-bull' : r.correlation < -0.5 ? 'text-data-bear' : 'text-data-neutral'}`}>
        {r.correlation.toFixed(3)}
      </span>
    )},
    { key: 'significance', header: 'Strength', width: 80, render: r => (
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
        r.significance === 'strong' ? 'bg-data-bull/20 text-data-bull' :
        r.significance === 'moderate' ? 'bg-data-warn/20 text-data-warn' :
        'bg-data-neutral/20 text-data-neutral'
      }`}>{r.significance}</span>
    )},
    { key: 'pValue', header: 'p-value', width: 80, align: 'right', render: r => <span className="text-text-muted font-mono">{r.pValue.toFixed(4)}</span> },
    { key: 'sampleSize', header: 'N', width: 50, align: 'right', render: r => <span className="text-text-secondary">{r.sampleSize}</span> },
    { key: 'lag', header: 'Lag', width: 50, align: 'right', render: r => <span className="text-text-muted">{r.lag}d</span> },
    { key: 'description', header: 'Insight', width: 300, render: r => <span className="text-[10px] text-text-secondary line-clamp-2">{r.description}</span> },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Cross-Asset Correlations</h1>
            <p className="text-[11px] text-text-muted font-mono">THE differentiator — no competitor correlates TradFi + on-chain + weather + news</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <Panel title="Live Correlations" subtitle="Statistically significant cross-asset relationships" liveStatus={status} onRefresh={refresh} maxHeight={600}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={correlations as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={36}
            emptyState={<div className="text-text-muted text-[11px] p-4">Calculating correlations...</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
