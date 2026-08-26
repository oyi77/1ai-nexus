"use client"

import { useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
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

const CATEGORY_COLORS: Record<string, string> = {
  BTC: '#f97316', ETH: '#f97316', SOL: '#f97316',
  'Fear & Greed Index': '#8b5cf6',
  'S&P 500': '#3b82f6', Gold: '#f59e0b',
  'Avg Funding Rate': '#10b981',
  'Binance BTC': '#ef4444', 'OKX BTC': '#ef4444',
}

function getCorrelationColor(value: number): string {
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

function getTextColor(value: number): string {
  return Math.abs(value) >= 0.6 ? '#ffffff' : '#1f2937'
}

export default function CorrelationPage() {
  const { data, status, refresh } = useLiveFetch<CorrelationData[]>({
    url: '/api/v1/correlations',
    interval: 60_000,
    initialData: [],
  })

  const correlations = data || []

  // Build asset list and matrix from correlation data
  const { assets, matrix } = useMemo(() => {
    const assetSet = new Set<string>()
    for (const row of correlations) {
      assetSet.add(row.assetA)
      assetSet.add(row.assetB)
    }
    const assetList = Array.from(assetSet)

    const lookup = new Map<string, number>()
    for (const row of correlations) {
      lookup.set(`${row.assetA}||${row.assetB}`, row.correlation)
      lookup.set(`${row.assetB}||${row.assetA}`, row.correlation)
    }

    const mat = assetList.map((a) =>
      assetList.map((b) => {
        if (a === b) return 1
        return lookup.get(`${a}||${b}`) ?? null
      }),
    )

    return { assets: assetList, matrix: mat }
  }, [correlations])

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="page-title">CROSS-ASSET CORRELATION MATRIX</h1>
            <p className="text-xs text-text-muted mt-1">
              Live cross-asset correlations from CoinGecko, Fear &amp; Greed, Binance, Yahoo Finance
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        <Panel title="Correlation Matrix" subtitle={`${assets.length} assets`} liveStatus={status} onRefresh={refresh} maxHeight={600}>
          {assets.length === 0 ? (
            <div className="text-text-muted text-xs p-8 text-center">Calculating correlations...</div>
          ) : (
            <div className="overflow-x-auto p-3">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="p-1" />
                    {assets.map((asset) => (
                      <th key={asset} className="p-1 text-xs text-text-muted" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '80px' }}>
                        <span className="w-2 h-2 rounded-full inline-block mr-1" style={{ backgroundColor: CATEGORY_COLORS[asset] ?? '#6b7280' }} />
                        {asset.replace('Fear & Greed Index', 'FGI').replace(' Avg Funding Rate', 'Funding')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset, i) => (
                    <tr key={asset}>
                      <td className="p-1 text-xs font-mono text-text-muted text-right whitespace-nowrap pr-2">
                        <span className="w-2 h-2 rounded-full inline-block mr-1" style={{ backgroundColor: CATEGORY_COLORS[asset] ?? '#6b7280' }} />
                        {asset.replace('Fear & Greed Index', 'FGI').replace(' Avg Funding Rate', 'Funding')}
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

        {/* Legend */}
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
              <p className="text-accent-cyan mb-1">Grey Cells</p>
              <p>No direct correlation data available for that pair.</p>
            </div>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
