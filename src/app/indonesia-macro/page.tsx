"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface IndonesiaIndicator {
  id: string
  title: string
  unit: string
  category: string
  latestValue: string
  latestDate: string
}

export function IndonesiaMacroContent() {
  const [data, setData] = useState<IndonesiaIndicator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/indonesia-macro')
      .then(r => r.json())
      .then(d => {
        setData(d.data ?? [])
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const categories = [...new Set(data.map(d => d.category))]

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
            <span className="text-teal-vivid">🇮🇩</span> Indonesia Macro Dashboard
          </h1>
          <p className="text-[12px] text-text-muted font-mono mt-1">
            Bank Indonesia, BPS, World Bank — {data.length} indicators tracked
          </p>
        </div>
        <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
      </div>

      {error && (
        <div className="text-data-bear text-[11px] font-mono p-4 bg-bg-panel rounded border border-border-dim">
          Error: {error}
        </div>
      )}

      {loading ? (
        <div className="text-text-dim text-xs p-8 text-center">Loading Indonesian macro data...</div>
      ) : data.length === 0 ? (
        <div className="text-text-dim text-xs p-8 text-center">No data available</div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {/* Summary Panel */}
          <div className="col-span-4 space-y-4">
            <Panel title="Indonesia Key Metrics" subtitle="Latest available data">
              <div className="space-y-3 p-2">
                {data.filter(d => ['IDN-GDP', 'IDN-INFLATION', 'IDN-UNEMPLOYMENT', 'IDN-POPULATION'].includes(d.id)).map(ind => (
                  <div key={ind.id} className="flex items-center justify-between py-1 border-b border-bg-border">
                    <span className="text-[11px] text-text-muted font-mono">{ind.title.replace('Indonesia ', '')}</span>
                    <div className="text-right">
                      <span className="text-[16px] font-head font-bold text-text-primary tabular-nums">{ind.latestValue}</span>
                      <span className="text-[9px] text-text-muted ml-1">{ind.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* All Indicators by Category */}
          <div className="col-span-8 space-y-4">
            {categories.map(cat => (
              <Panel key={cat} title={cat.charAt(0).toUpperCase() + cat.slice(1)} subtitle={`${data.filter(d => d.category === cat).length} indicators`}>
                <div className="grid grid-cols-2 gap-3 p-2">
                  {data.filter(d => d.category === cat).map(ind => (
                    <div key={ind.id} className="bg-bg-raised p-3 rounded border border-bg-border">
                      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{ind.title}</div>
                      <div className="text-[20px] font-head font-bold text-text-primary tabular-nums">
                        {ind.latestValue}
                        <span className="text-[10px] text-text-muted ml-1">{ind.unit}</span>
                      </div>
                      <div className="text-[9px] font-mono text-text-muted mt-1">{ind.latestDate}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}

      <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
        <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
        <p className="text-xs text-text-dim">
          World Bank Open Data (api.worldbank.org) — free, no API key. Annual data for Indonesia (IDN).
          For real-time BI Rate and monthly data, Bank Indonesia API integration is planned.
        </p>
      </div>
    </div>
  )
}

export default function IndonesiaMacroPage() {
  return <NexusLayout><IndonesiaMacroContent /></NexusLayout>
}
