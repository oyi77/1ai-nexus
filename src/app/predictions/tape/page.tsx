"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Activity, RefreshCw } from "lucide-react"
import Link from "next/link"

interface Market {
  id: string
  question: string
  totalVolume?: number
  volume24h?: number
  yesPrice?: number
  noPrice?: number
  traderCount?: number
  status?: string
  category?: string
  createdAt?: string
}

export default function PredictionsTapePage() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)

  const fetchMarkets = () => {
    setLoading(true)
    fetch('/api/v1/predictions?pageSize=50&sort=createdAt&order=desc')
      .then(r => r.json())
      .then(d => {
        setMarkets(d.data ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    const invoke = () => fetchMarkets()
    invoke()
  }, [])

  return (
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
            <Activity size={14} /> PREDICTION TAPE
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-muted">{markets.length} recent</span>
            <button
              onClick={fetchMarkets}
              className="text-text-dim hover:text-accent-cyan transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-text-dim text-xs">Loading market tape...</div>
        ) : markets.length === 0 ? (
          <div className="text-center py-20 text-text-dim text-xs">No market activity</div>
        ) : (
          <div className="space-y-1.5">
            {markets.map((m) => (
              <Link
                key={m.id}
                href={`/predictions/${m.id}`}
                className="flex items-start gap-3 px-3 py-2 bg-bg-panel border border-border-dim rounded-lg hover:border-border-active transition-colors"
              >
                {/* Timestamp column */}
                <div className="flex-shrink-0 w-16 text-right">
                  {m.createdAt && (
                    <span className="text-[10px] font-mono text-text-muted">
                      {formatTime(m.createdAt)}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary leading-tight line-clamp-2">
                    {m.question || 'Unknown market'}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {m.yesPrice != null && (
                      <span className="text-[10px] font-mono text-accent-cyan">
                        YES {(m.yesPrice * 100).toFixed(0)}¢
                      </span>
                    )}
                    {m.noPrice != null && (
                      <span className="text-[10px] font-mono text-text-dim">
                        NO {(m.noPrice * 100).toFixed(0)}¢
                      </span>
                    )}
                    {m.volume24h != null && m.volume24h > 0 && (
                      <span className="text-[10px] font-mono text-text-muted">
                        ${formatNum(m.volume24h)} 24h
                      </span>
                    )}
                    {m.category && (
                      <span className="text-[10px] text-text-muted">{m.category}</span>
                    )}
                  </div>
                </div>

                {/* Status indicator */}
                <div className="flex-shrink-0">
                  <span className={`text-[10px] ${m.status === 'open' ? 'text-green-500' : 'text-text-dim'}`}>
                    {m.status === 'open' ? '●' : '○'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="text-center pt-2">
          <Link href="/predictions" className="text-[10px] text-text-dim hover:text-accent-cyan transition-colors">
            ← Back to all markets
          </Link>
        </div>
      </div>
    </NexusLayout>
  )
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}
