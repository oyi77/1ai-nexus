"use client"

import { useMemo } from 'react'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { LiveDot } from '@/components/primitives/LiveDot'
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

const getCorrelationColor = (value: number) => {
  if (value >= 0.8) return '#166534'
  if (value >= 0.6) return '#15803d'
  if (value >= 0.4) return '#22c55e'
  if (value >= 0.2) return '#86efac'
  if (value >= 0) return '#bbf7d0'
  if (value >= -0.2) return '#fecaca'
  if (value >= -0.4) return '#fca5a5'
  if (value >= -0.6) return '#f87171'
  if (value >= -0.8) return '#ef4444'
  return '#991b1b'
}

const getTextColor = (value: number) => Math.abs(value) >= 0.6 ? '#ffffff' : '#1f2937'

export function CorrelationsPageContent() {
  return <CorrelationsPageInner />
}



function CorrelationsPageInner() {
  const { data, status, refresh } = useLiveFetch<CorrelationData[]>({ url: '/api/v1/correlations', interval: 60_000, initialData: [] })
  const correlations = useMemo(() => data || [], [data])

  const columns: Column<CorrelationData>[] = [
    { key: 'pair', header: 'Pair', width: 150, render: r => <span className="text-teal-vivid font-bold">{r.pair}</span> },
    { key: 'correlation', header: 'Correlation', width: 100, align: 'right', render: r => (
      <span className={`font-mono font-bold ${(r.correlation ?? 0) > 0.5 ? 'text-data-bull' : (r.correlation ?? 0) < -0.5 ? 'text-data-bear' : 'text-data-neutral'}`}>
        {(r.correlation ?? 0).toFixed(3)}
      </span>
    )},
    { key: 'significance', header: 'Strength', width: 80, render: r => (
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
        r.significance === 'strong' ? 'bg-data-bull/20 text-data-bull' :
        r.significance === 'moderate' ? 'bg-data-warn/20 text-data-warn' :
        'bg-data-neutral/20 text-data-neutral'
      }`}>{r.significance}</span>
    )},
    { key: 'pValue', header: 'p-value', width: 80, align: 'right', render: r => <span className="text-text-muted font-mono">{(r.pValue ?? 0).toFixed(4)}</span> },
    { key: 'sampleSize', header: 'N', width: 50, align: 'right', render: r => <span className="text-text-secondary">{r.sampleSize}</span> },
    { key: 'lag', header: 'Lag', width: 50, align: 'right', render: r => <span className="text-text-muted">{r.lag}d</span> },
    { key: 'description', header: 'Insight', width: 300, render: r => <span className="text-xs text-text-secondary line-clamp-2">{r.description}</span> },
  ]

  const assets = useMemo(() => {
    const set = new Set<string>()
    for (const row of correlations) {
      set.add(row.assetA)
      set.add(row.assetB)
    }
    return Array.from(set)
  }, [correlations])

  const matrix = useMemo(() => {
    const lookup = new Map<string, number>()
    for (const row of correlations) {
      lookup.set(`${row.assetA}||${row.assetB}`, row.correlation)
      lookup.set(`${row.assetB}||${row.assetA}`, row.correlation)
    }

    return assets.map((assetA) =>
      assets.map((assetB) => {
        if (assetA === assetB) return 1
        return lookup.get(`${assetA}||${assetB}`) ?? null
      }),
    )
  }, [assets, correlations])

  return (
    <>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Cross-Asset Correlations</h1>
            <p className="text-xs text-text-muted">TradFi + crypto + macro relationships, with matrix heatmap and ranked table</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <Panel title="Correlation Matrix" subtitle={`${assets.length} assets`} liveStatus={status} onRefresh={refresh} maxHeight={520}>
          {assets.length === 0 ? (
            <div className="text-text-muted text-xs p-4 text-center">Calculating correlations...</div>
          ) : (
            <div className="overflow-x-auto p-3">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="p-1" />
                    {assets.map((asset) => (
                      <th key={asset} className="p-1 text-xs text-text-muted" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '88px' }}>
                        {asset.replace('Fear & Greed Index', 'FGI').replace(' Price', '').slice(0, 12)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset, i) => (
                    <tr key={asset}>
                      <td className="p-1 text-xs font-mono text-text-muted text-right whitespace-nowrap pr-2">
                        {asset.replace('Fear & Greed Index', 'FGI').replace(' Price', '').slice(0, 18)}
                      </td>
                      {matrix[i]?.map((val, j) => (
                        <td key={`${asset}-${assets[j]}`} className="p-0.5">
                          <div
                            className="w-9 h-9 flex items-center justify-center rounded text-[8px] font-mono font-bold"
                            style={{
                              backgroundColor: val == null ? '#1f2937' : getCorrelationColor(val),
                              color: val == null ? '#9ca3af' : getTextColor(val),
                            }}
                            title={val == null ? `${asset} vs ${assets[j]}: no data` : `${asset} vs ${assets[j]}: ${val.toFixed(3)}`}
                          >
                            {val == null ? '—' : val.toFixed(2)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Live Correlations" subtitle="Ranked pair relationships" liveStatus={status} onRefresh={refresh} maxHeight={600}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={correlations as unknown as Record<string, unknown>[]}
            sortable
            filterable
            filterPlaceholder="Filter correlations…"
            rowHeight={36}
            emptyState={<div className="text-text-muted text-xs p-4">Calculating correlations...</div>}
          />
        </Panel>

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs text-accent-cyan mb-2">INTERPRETATION</h2>
          <div className="grid grid-cols-2 gap-4 text-xs text-text-dim">
            <div>
              <p className="text-data-bull mb-1">High Positive (+0.6 to +1.0)</p>
              <p>Assets move together. Diversification benefit is low.</p>
            </div>
            <div>
              <p className="text-data-bear mb-1">High Negative (-0.6 to -1.0)</p>
              <p>Assets move opposite. Strong hedge opportunity.</p>
            </div>
            <div>
              <p className="text-text-muted mb-1">Near Zero (-0.2 to +0.2)</p>
              <p>Assets are uncorrelated. Best diversification.</p>
            </div>
            <div>
              <p className="text-accent-cyan mb-1">Matrix View</p>
              <p>Diagonal is self-correlation (1.00). Grey cells indicate no direct pair in the current engine output.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
