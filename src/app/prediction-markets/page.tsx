"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Market {
  id: string
  platform: string
  question: string
  yesPrice: number
  noPrice: number
  volume: number
  category: string
  timeRemaining: string
  edge: number
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export default function PredictionMarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [cryptoMarkets, setCryptoMarkets] = useState<Market[]>([])
  const [economicsMarkets, setEconomicsMarkets] = useState<Market[]>([])
  const [totalVolume, setTotalVolume] = useState(0)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [filter, setFilter] = useState<'all' | 'crypto' | 'economics'>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/prediction-markets')
      const d = await res.json()
      if (d.success && d.data) {
        setMarkets(d.data.markets ?? [])
        setCryptoMarkets(d.data.cryptoMarkets ?? [])
        setEconomicsMarkets(d.data.economicsMarkets ?? [])
        setTotalVolume(d.data.totalVolume ?? 0)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 300_000)
    return () => clearInterval(id)
  }, [fetchData])

  const filtered = filter === 'crypto' ? cryptoMarkets : filter === 'economics' ? economicsMarkets : markets

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-accent-amber">🎯</span> Prediction Markets
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Aggregated prediction markets from Polymarket and Kalshi. Find edge in crowd wisdom.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        <div className="grid grid-cols-4 gap-2">
          <KPI label="Total Markets" value={String(markets.length)} />
          <KPI label="Crypto Markets" value={String(cryptoMarkets.length)} />
          <KPI label="Economics Markets" value={String(economicsMarkets.length)} />
          <KPI label="Total Volume" value={fmtUsd(totalVolume)} />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-text-muted uppercase">Filter:</span>
          <div className="flex bg-bg-raised p-1 rounded">
            {(['all', 'crypto', 'economics'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-mono rounded uppercase transition-colors ${filter === f ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <Panel title="Markets" subtitle={`${filtered.length} active markets`} liveStatus={status} onRefresh={fetchData}>
          <div className="p-3 grid grid-cols-2 gap-3">
            {filtered.slice(0, 20).map((m, i) => (
              <div key={i} className="bg-bg-raised p-4 rounded border border-bg-border hover:border-teal-vivid transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted uppercase">{m.platform}</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent-amber/20 text-accent-amber">{m.category}</span>
                </div>
                <p className="text-[12px] font-mono text-text-primary leading-tight mb-3 line-clamp-2">{m.question}</p>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-data-bull">YES</span>
                    <span className="text-[16px] font-mono font-bold text-data-bull tabular-nums">{(m.yesPrice * 100).toFixed(1)}¢</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-mono font-bold text-data-bear tabular-nums">{(m.noPrice * 100).toFixed(1)}¢</span>
                    <span className="text-[10px] font-mono text-data-bear">NO</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
                  <span>Vol: {fmtUsd(m.volume)}</span>
                  <span>{m.timeRemaining}</span>
                  {m.edge > 0.1 && (
                    <span className="text-teal-vivid font-bold">Edge: {(m.edge * 100).toFixed(1)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}