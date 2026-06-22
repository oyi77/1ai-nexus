"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

const CRYPTO_ADJACENT = ['MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'HOOD', 'ARKK']
const INDICES = ['^GSPC', '^IXIC', '^DJI', '^VIX']

export default function EquitiesPage() {
  const [quotes, setQuotes] = useState<Record<string, { price: number; change: number; name: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const allSymbols = [...CRYPTO_ADJACENT, ...INDICES].join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${allSymbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, { price: number; change: number; name: string }> = {}
        for (const q of d.data ?? []) {
          map[q.symbol] = { price: q.regularMarketPrice, change: q.regularMarketChangePercent, name: q.shortName ?? q.symbol }
        }
        setQuotes(map)
        setLoading(false)
      })
      .catch((err) => { setLoading(false); setError((err as Error).message) })
  }, [])

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-bold font-mono text-accent-cyan">EQUITIES — CRYPTO-ADJACENT</h1>
        {error && <div className="text-data-bear text-[11px] font-mono p-4">Error: {error}</div>}

        {/* Indices */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">MAJOR INDICES</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {INDICES.map(sym => {
              const q = quotes[sym]
              return (
                <div key={sym} className="p-2">
                  <p className="text-[10px] text-text-muted">{q?.name ?? sym}</p>
                  <p className="text-lg font-mono font-bold">{q?.price?.toFixed(2) ?? '—'}</p>
                  <p className={`text-xs font-mono ${(q?.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {q?.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Crypto-Adjacent Stocks */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">CRYPTO-ADJACENT STOCKS</h2>
          {loading ? (
            <div className="text-text-dim text-xs">Loading Yahoo Finance RE data...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 font-mono">SYMBOL</th>
                    <th className="text-left py-2 font-mono">NAME</th>
                    <th className="text-right py-2 font-mono">PRICE</th>
                    <th className="text-right py-2 font-mono">CHANGE</th>
                  </tr>
                </thead>
                <tbody>
                  {CRYPTO_ADJACENT.map(sym => {
                    const q = quotes[sym]
                    return (
                      <tr key={sym} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 font-mono text-accent-cyan">{sym}</td>
                        <td className="py-2 text-text-dim">{q?.name ?? '—'}</td>
                        <td className="py-2 text-right font-mono">{q?.price?.toFixed(2) ?? '—'}</td>
                        <td className={`py-2 text-right font-mono ${(q?.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {q?.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}
