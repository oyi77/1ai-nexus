"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Target, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface Market {
  id: string
  question: string
  outcome?: string
  totalVolume?: number
  volume24h?: number
  liquidity?: number
  status?: string
  category?: string
  yesPrice?: number
  noPrice?: number
  traderCount?: number
  createdAt?: string
}

export default function PredictionMarketPage() {
  const params = useParams()
  const marketId = params?.marketId as string
  const [market, setMarket] = useState<Market | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!marketId) return
    fetch('/api/v1/predictions?pageSize=100&sort=totalVolume&order=desc')
      .then(r => r.json())
      .then(d => {
        const items: Market[] = d.data ?? []
        const found = items.find(m => m.id === marketId) ?? null
        if (found) {
          setMarket(found)
        } else {
          setNotFound(true)
        }
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [marketId])

  return (
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/predictions" className="text-text-dim hover:text-accent-cyan transition-colors">
            <ArrowLeft size={14} />
          </Link>
          <h1 className="text-sm font-bold text-accent-cyan flex items-center gap-2">
            <Target size={14} /> MARKET DETAIL
          </h1>
        </div>

        {loading ? (
          <div className="text-center py-20 text-text-dim text-xs">Loading market...</div>
        ) : notFound ? (
          <div className="text-center py-20 text-text-dim text-xs">
            Market not found. It may be closed or delisted.
            <div className="mt-4">
              <Link href="/predictions" className="text-accent-cyan hover:underline text-xs">← Back to markets</Link>
            </div>
          </div>
        ) : market ? (
          <div className="space-y-4">
            {/* Question */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-sm text-text-primary leading-snug mb-3">
                {market.question}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs px-2 py-0.5 rounded bg-bg-base border border-border-dim text-text-dim">
                  {market.status === 'open' ? '🟢 Open' : market.status === 'closed' ? '🔴 Closed' : market.status ?? 'Unknown'}
                </span>
                {market.category && (
                  <span className="text-xs px-2 py-0.5 rounded bg-bg-base border border-border-dim text-text-muted">
                    {market.category}
                  </span>
                )}
                {market.traderCount != null && (
                  <span className="text-xs text-text-dim">
                    {formatNum(market.traderCount)} traders
                  </span>
                )}
              </div>
            </div>

            {/* Prices */}
            {(market.yesPrice != null || market.noPrice != null) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                  <p className="text-xs text-text-muted mb-1">YES</p>
                  <p className="text-lg font-bold text-accent-cyan">
                    {market.yesPrice != null ? `${(market.yesPrice * 100).toFixed(1)}¢` : '—'}
                  </p>
                </div>
                <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                  <p className="text-xs text-text-muted mb-1">NO</p>
                  <p className="text-lg font-bold text-text-dim">
                    {market.noPrice != null ? `${(market.noPrice * 100).toFixed(1)}¢` : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* Volume & Liquidity */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">Total Volume</p>
                <p className="text-sm font-bold text-accent-cyan">
                  {market.totalVolume != null ? `$${formatNum(market.totalVolume)}` : '—'}
                </p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">24h Volume</p>
                <p className="text-sm font-bold text-accent-cyan">
                  {market.volume24h != null ? `$${formatNum(market.volume24h)}` : '—'}
                </p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">Liquidity</p>
                <p className="text-sm font-bold text-accent-cyan">
                  {market.liquidity != null ? `$${formatNum(market.liquidity)}` : '—'}
                </p>
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-xs text-text-muted mb-2">Market Info</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-text-muted">ID: </span>
                  <span className="text-text-dim font-mono break-all">{market.id}</span>
                </div>
                {market.outcome && (
                  <div>
                    <span className="text-text-muted">Outcome: </span>
                    <span className="text-text-primary">{market.outcome}</span>
                  </div>
                )}
                {market.createdAt && (
                  <div>
                    <span className="text-text-muted">Created: </span>
                    <span className="text-text-dim font-mono">{new Date(market.createdAt).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </NexusLayout>
  )
}

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}
