"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { Target } from "lucide-react"

interface Market {
  id: string
  question: string
  outcome?: string
  volume?: number
  liquidity?: number
  active?: boolean
}

export default function PredictionsPage() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/modules/fetch?module=polymarket&action=markets&limit=30')
      .then(r => r.json())
      .then(d => {
        const items = (d.data ?? [])
        // Handle different response shapes
        const marketList = Array.isArray(items) ? items : (items.data ?? [])
        setMarkets(marketList.slice(0, 30))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <TerminalShell>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
            <Target size={14} /> PREDICTION MARKETS
          </h1>
          <span className="text-[10px] text-text-muted">{markets.length} markets · Polymarket</span>
        </div>

        {loading ? (
          <div className="text-center py-20 text-text-dim text-xs">Loading prediction markets from Polymarket...</div>
        ) : markets.length === 0 ? (
          <div className="text-center py-20 text-text-dim text-xs">No prediction markets available</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {markets.map((m, i) => (
              <div key={m.id || i} className="bg-bg-panel border border-border-dim rounded-lg p-3 hover:border-border-active transition-colors cursor-pointer">
                <p className="text-xs text-text-primary leading-tight mb-2 line-clamp-2">
                  {m.question || 'Unknown market'}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-dim">
                    {m.active !== false ? '🟢 Active' : '🔴 Closed'}
                  </span>
                  {m.volume != null && (
                    <span className="text-[10px] text-accent-cyan font-mono">
                      Vol: ${formatNum(m.volume)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TerminalShell>
  )
}

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}
