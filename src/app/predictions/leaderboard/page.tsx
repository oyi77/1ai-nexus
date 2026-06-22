"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Trophy } from "lucide-react"
import Link from "next/link"

interface Market {
  id: string
  question: string
  totalVolume?: number
  volume24h?: number
  traderCount?: number
  yesPrice?: number
  status?: string
  category?: string
}

export default function PredictionsLeaderboardPage() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<"totalVolume" | "volume24h" | "traderCount">("totalVolume")

  useEffect(() => {
    const startLoad = () => setLoading(true)
    startLoad()
    fetch(`/api/v1/predictions?pageSize=50&sort=${sortBy}&order=desc`)
      .then(r => r.json())
      .then(d => {
        setMarkets(d.data ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [sortBy])

  return (
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
            <Trophy size={14} /> PREDICTION LEADERBOARD
          </h1>
          <span className="text-[10px] text-text-muted">Top markets by volume</span>
        </div>

        {/* Sort tabs */}
        <div className="flex gap-2">
          {([["totalVolume", "Total Volume"], ["volume24h", "24h Volume"], ["traderCount", "Traders"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                sortBy === key
                  ? "border-accent-cyan text-accent-cyan bg-bg-panel"
                  : "border-border-dim text-text-dim hover:border-border-active"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20 text-text-dim text-xs">Loading leaderboard...</div>
        ) : markets.length === 0 ? (
          <div className="text-center py-20 text-text-dim text-xs">No markets available</div>
        ) : (
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] text-text-muted font-mono border-b border-border-dim">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Market</div>
              <div className="col-span-2 text-right">Volume</div>
              <div className="col-span-2 text-right">24h Vol</div>
              <div className="col-span-2 text-right">Traders</div>
            </div>
            {/* Rows */}
            {markets.map((m, i) => (
              <Link
                key={m.id}
                href={`/predictions/${m.id}`}
                className="grid grid-cols-12 gap-2 px-3 py-2.5 bg-bg-panel border border-border-dim rounded-lg hover:border-border-active transition-colors items-center"
              >
                <div className="col-span-1 text-xs font-mono text-text-muted">
                  {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                </div>
                <div className="col-span-5">
                  <p className="text-xs text-text-primary leading-tight line-clamp-2">{m.question || 'Unknown'}</p>
                  <div className="flex gap-2 mt-0.5">
                    {m.category && <span className="text-[9px] text-text-muted">{m.category}</span>}
                    {m.status && (
                      <span className={`text-[9px] ${m.status === 'open' ? 'text-green-500' : 'text-text-dim'}`}>
                        {m.status === 'open' ? '●' : '○'} {m.status}
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-span-2 text-right">
                  <span className="text-xs font-mono text-accent-cyan">
                    {m.totalVolume != null ? `$${formatNum(m.totalVolume)}` : '—'}
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  <span className="text-xs font-mono text-text-dim">
                    {m.volume24h != null ? `$${formatNum(m.volume24h)}` : '—'}
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  <span className="text-xs font-mono text-text-dim">
                    {m.traderCount != null ? formatNum(m.traderCount) : '—'}
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

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}
