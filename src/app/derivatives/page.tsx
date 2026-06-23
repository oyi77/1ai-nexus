"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'

interface DerivPair {
  symbol: string
  baseAsset: string
  price: number
  priceChange24h: number
  volume24h: number
  quoteVolume24h: number
  openInterest: number
  fundingRate: number
  nextFundingTime: number
  high24h: number
  low24h: number
  [key: string]: unknown
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

function fundingColor(rate: number): string {
  if (rate > 0.0001) return 'text-data-bear' // Positive = longs pay shorts = bearish signal
  if (rate < -0.0001) return 'text-data-bull' // Negative = shorts pay longs = bullish signal
  return 'text-text-muted'
}

function fundingLabel(rate: number): string {
  const pct = rate * 100
  if (pct > 0.05) return '🔥 Very Bullish Funding'
  if (pct > 0.01) return '📈 Bullish Funding'
  if (pct < -0.05) return '💀 Very Bearish Funding'
  if (pct < -0.01) return '📉 Bearish Funding'
  return '⚖️ Neutral'
}

export default function DerivativesPage() {
  const [pairs, setPairs] = useState<DerivPair[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [sortBy, setSortBy] = useState<'volume' | 'funding' | 'oi'>('volume')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/derivatives?limit=50')
      const d = await res.json()
      const items = d.data?.topPairs ?? []
      setPairs(items.map((p: Record<string, unknown>) => ({
        symbol: String(p.symbol ?? ''),
        baseAsset: String(p.baseAsset ?? ''),
        price: Number(p.price ?? 0),
        priceChange24h: Number(p.priceChange24h ?? 0),
        volume24h: Number(p.quoteVolume24h ?? 0),
        quoteVolume24h: Number(p.quoteVolume24h ?? 0),
        openInterest: Number(p.openInterest ?? 0),
        fundingRate: Number(p.fundingRate ?? 0),
        nextFundingTime: Number(p.nextFundingTime ?? 0),
        high24h: Number(p.high24h ?? 0),
        low24h: Number(p.low24h ?? 0),
      })))
      setStatus('live')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 15_000)
    return () => clearInterval(id)
  }, [fetchData])

  const sorted = [...pairs].sort((a, b) => {
    if (sortBy === 'funding') return Math.abs(b.fundingRate) - Math.abs(a.fundingRate)
    if (sortBy === 'oi') return b.openInterest - a.openInterest
    return b.volume24h - a.volume24h
  })

  const columns: Column<DerivPair>[] = [
    { key: 'symbol', header: 'Pair', width: 100, render: r => (
      <span className="text-teal-vivid font-bold text-[11px]">{r.baseAsset}</span>
    )},
    { key: 'price', header: 'Price', width: 100, align: 'right', render: r => (
      <PriceTag value={r.price} size="sm" />
    )},
    { key: 'priceChange24h', header: '24h%', width: 70, align: 'right', render: r => (
      <DeltaBadge value={r.priceChange24h} size="xs" />
    )},
    { key: 'volume24h', header: 'Vol 24h', width: 100, align: 'right', render: r => (
      <span className="text-text-secondary font-mono text-[10px]">{fmtUsd(r.volume24h)}</span>
    )},
    { key: 'openInterest', header: 'Open Interest', width: 110, align: 'right', render: r => (
      <span className="text-text-primary font-mono text-[11px] font-bold tabular-nums">
        {r.openInterest > 0 ? `${r.openInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${r.baseAsset}` : '—'}
      </span>
    )},
    { key: 'fundingRate', header: 'Funding Rate', width: 120, align: 'right', render: r => (
      <div className="flex flex-col items-end">
        <span className={`font-mono text-[11px] font-bold ${fundingColor(r.fundingRate)}`}>
          {(r.fundingRate * 100).toFixed(4)}%
        </span>
        <span className="text-[9px] font-mono text-text-muted">{fundingLabel(r.fundingRate)}</span>
      </div>
    )},
    { key: 'nextFundingTime', header: 'Next Funding', width: 100, align: 'right', render: r => {
      if (!r.nextFundingTime) return <span className="text-text-muted text-[10px]">—</span>
      const mins = Math.floor((r.nextFundingTime - Date.now()) / 60000)
      const hrs = Math.floor(mins / 60)
      const remMins = mins % 60
      return <span className="text-text-muted font-mono text-[10px]">{hrs}h {remMins}m</span>
    }},
    { key: 'high24h', header: '24h High', width: 90, align: 'right', render: r => (
      <span className="text-data-bull font-mono text-[10px]">{r.high24h > 0 ? `$${r.high24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</span>
    )},
    { key: 'low24h', header: '24h Low', width: 90, align: 'right', render: r => (
      <span className="text-data-bear font-mono text-[10px]">{r.low24h > 0 ? `$${r.low24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</span>
    )},
  ]

  // Extreme funding opportunities
  const extremeFunding = [...pairs]
    .filter(p => Math.abs(p.fundingRate) > 0.0001)
    .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate))
    .slice(0, 5)

  // Highest OI
  const topOI = [...pairs].sort((a, b) => b.openInterest - a.openInterest).slice(0, 5)

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">📊</span> Derivatives Terminal
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Real-time funding rates, open interest, and liquidation levels from Binance Futures
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-5 gap-2">
          <StatCard label="Total Pairs" value={String(pairs.length)} />
          <StatCard label="Total Vol 24h" value={fmtUsd(pairs.reduce((s, p) => s + p.volume24h, 0))} />
          <StatCard label="Avg Funding" value={`${(pairs.reduce((s, p) => s + p.fundingRate, 0) / (pairs.length || 1) * 100).toFixed(4)}%`} />
          <StatCard label="Positive Funding" value={String(pairs.filter(p => p.fundingRate > 0).length)} />
          <StatCard label="Negative Funding" value={String(pairs.filter(p => p.fundingRate < 0).length)} />
        </div>

        {/* Funding Arbitrage Scanner */}
        <div className="grid grid-cols-2 gap-4">
          <Panel title="⚡ Extreme Funding Rates" subtitle="Potential arbitrage opportunities" liveStatus={status}>
            <div className="p-3 space-y-2">
              {extremeFunding.map((p, i) => (
                <div key={i} className="flex items-center justify-between bg-bg-raised p-2 rounded">
                  <div className="flex items-center gap-2">
                    <span className="text-teal-vivid font-bold text-[12px]">{p.baseAsset}</span>
                    <span className={`text-[10px] font-mono ${fundingColor(p.fundingRate)}`}>
                      {(p.fundingRate * 100).toFixed(4)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-text-muted">OI: {p.openInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className={`text-[10px] font-mono font-bold ${p.fundingRate > 0 ? 'text-data-bear' : 'text-data-bull'}`}>
                      {p.fundingRate > 0 ? 'SHORTS PAID' : 'LONGS PAID'}
                    </span>
                  </div>
                </div>
              ))}
              {extremeFunding.length === 0 && (
                <div className="text-text-muted text-[11px] font-mono p-4 text-center">No extreme funding rates detected</div>
              )}
            </div>
          </Panel>

          <Panel title="🏗️ Top Open Interest" subtitle="Largest positions in market" liveStatus={status}>
            <div className="p-3 space-y-2">
              {topOI.map((p, i) => (
                <div key={i} className="flex items-center justify-between bg-bg-raised p-2 rounded">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted font-mono text-[10px]">#{i + 1}</span>
                    <span className="text-teal-vivid font-bold text-[12px]">{p.baseAsset}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-mono font-bold text-text-primary tabular-nums">
                      {p.openInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })} {p.baseAsset}
                    </span>
                    <span className="text-[10px] font-mono text-text-muted">
                      ${((p.openInterest * p.price) / 1e6).toFixed(1)}M
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Full Table */}
        <Panel title="All Perpetual Contracts" subtitle={`${sorted.length} pairs from Binance Futures`} liveStatus={status} onRefresh={fetchData}>
          <div className="flex items-center gap-1 p-2 border-b border-bg-border">
            <span className="text-[10px] font-mono text-text-muted mr-2">Sort by:</span>
            {(['volume', 'funding', 'oi'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1 text-[10px] font-mono rounded uppercase transition-colors ${sortBy === s ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary bg-bg-raised'}`}
              >
                {s === 'oi' ? 'Open Interest' : s}
              </button>
            ))}
          </div>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={sorted as unknown as Record<string, unknown>[]}
            rowHeight={36}
            emptyState={<div className="text-text-muted text-[12px] p-8 text-center">Loading derivatives data...</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className="text-[16px] font-head font-bold tabular-nums text-text-primary">{value}</div>
    </div>
  )
}