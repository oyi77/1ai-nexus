"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

interface FredData {
  seriesId: string
  meta?: { title: string; unit: string; category: string }
  observations: Array<{ date: string; value: number }>
}

interface FearGreedData {
  value: number
  classification: string
}

const MACRO_SERIES = [
  { id: 'FEDFUNDS', label: 'Fed Funds Rate', unit: '%' },
  { id: 'DGS10', label: '10Y Treasury', unit: '%' },
  { id: 'CPIAUCSL', label: 'CPI', unit: 'Index' },
  { id: 'UNRATE', label: 'Unemployment', unit: '%' },
  { id: 'GDP', label: 'GDP', unit: '$B' },
]

export default function MacroPage() {
  const [fredData, setFredData] = useState<Record<string, FredData>>({})
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const results = await Promise.allSettled(
        MACRO_SERIES.map(s =>
          fetch(`/api/v1/modules/fetch?module=fred&series=${s.id}&limit=5`)
            .then(r => r.json())
        )
      )

      const data: Record<string, FredData> = {}
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.data) {
          data[MACRO_SERIES[i].id] = r.value.data
        }
      })
      setFredData(data)

      // Fear & Greed
      const fgRes = await fetch('/api/v1/market/sentiment').then(r => r.json())
      if (fgRes.fearGreed != null) {
        setFearGreed({ value: fgRes.fearGreed, classification: fgRes.classification })
      }
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { const invoke = () => fetchData(); invoke() }, [fetchData])

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-bold font-mono text-accent-cyan">MACRO DASHBOARD</h1>

        {/* Fear & Greed */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">FEAR & GREED INDEX</h2>
          {fearGreed ? (
            <div className="flex items-center gap-4">
              <span className="text-4xl font-mono font-bold" style={{
                color: fearGreed.value >= 55 ? '#00ff88' : fearGreed.value >= 45 ? '#ffb800' : '#ff3060'
              }}>
                {fearGreed.value}
              </span>
              <span className="text-sm text-text-dim">{fearGreed.classification}</span>
            </div>
          ) : (
            <span className="text-text-dim text-xs">Loading...</span>
          )}
        </div>

        {/* FRED Series */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MACRO_SERIES.map(s => {
            const data = fredData[s.id]
            const latest = data?.observations?.[0]
            return (
              <div key={s.id} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h3 className="text-[10px] text-text-muted uppercase mb-1">{s.label}</h3>
                {loading ? (
                  <span className="text-text-dim text-xs">Loading...</span>
                ) : latest ? (
                  <div>
                    <span className="text-2xl font-mono font-bold text-text-primary">
                      {latest.value.toFixed(2)}
                    </span>
                    <span className="text-xs text-text-dim ml-1">{s.unit}</span>
                    <p className="text-[10px] text-text-muted mt-1">as of {latest.date}</p>
                  </div>
                ) : (
                  <span className="text-text-dim text-xs">No data</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </NexusLayout>
  )
}
