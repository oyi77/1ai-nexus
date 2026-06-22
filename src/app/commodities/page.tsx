"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

const COMMODITIES = [
  { symbol: 'GC=F', name: 'Gold', unit: '$/oz' },
  { symbol: 'SI=F', name: 'Silver', unit: '$/oz' },
  { symbol: 'CL=F', name: 'WTI Crude Oil', unit: '$/bbl' },
  { symbol: 'NG=F', name: 'Natural Gas', unit: '$/MMBtu' },
]

export default function CommoditiesPage() {
  const [quotes, setQuotes] = useState<Record<string, { price: number; change: number }>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const symbols = COMMODITIES.map(c => c.symbol).join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=commodities&symbols=${symbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, { price: number; change: number }> = {}
        for (const q of d.data ?? []) {
          map[q.symbol] = { price: q.regularMarketPrice, change: q.regularMarketChangePercent }
        }
        setQuotes(map)
        setLoading(false)
      })
      .catch((err) => { setLoading(false); setError((err as Error).message) })
  }, [])

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-bold font-mono text-accent-cyan">COMMODITIES</h1>
        {error && <div className="text-data-bear text-[11px] font-mono p-4">Error: {error}</div>}

        {loading ? (
          <div className="text-text-dim text-xs">Loading Yahoo Finance RE data...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COMMODITIES.map(c => {
              const q = quotes[c.symbol]
              return (
                <div key={c.symbol} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <p className="text-[10px] text-text-muted uppercase">{c.name}</p>
                  <p className="text-3xl font-mono font-bold text-text-primary">
                    ${q?.price?.toFixed(2) ?? '—'}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-sm font-mono ${(q?.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {q?.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                    </span>
                    <span className="text-xs text-text-dim">{c.unit}</span>
                  </div>
                  <p className="text-[10px] text-text-muted mt-2">{c.symbol} · Yahoo Finance RE 🟢</p>
                </div>
              )
            })}
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            Yahoo Finance RE 🟢 — community-validated internal JSON API.
            Fallback: cached last-known-good if endpoint changes.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
