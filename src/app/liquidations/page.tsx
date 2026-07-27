"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

// ── Types ─────────────────────────────────────────────────

interface HeatmapBin {
  priceLevel: number
  density: number
  longLiquidations: number
  shortLiquidations: number
  symbol: string
  totalUsd?: number
}

interface FundingEntry {
  symbol: string
  rate: number
  annualized: number
}

interface PositionEntry {
  symbol: string
  price: number
  openInterest: number
  fundingRate: number
  maxLeverage: number
}

interface LeaderboardEntry {
  address: string
  pnl: number
  volume: number
}

interface LiquidationsResponse {
  spotlight: { symbol: string; price: number; markPrice: number; openInterest: number; fundingRate: number; maxLeverage: number; priceChange24h: number }
  heatmap: HeatmapBin[]
  fundingStrip: FundingEntry[]
  topPositions: PositionEntry[]
  leaderboard: LeaderboardEntry[]
}

interface Cluster {
  priceLevel: number
  usdValue: number
  side: string
  distance: string
}

interface BinanceHeatmapData {
  symbol: string
  currentPrice: number
  markPrice: number
  fundingRate: number
  openInterest: number
  heatmap: Array<{ priceLevel: number; density: number; longLiquidations: number; shortLiquidations: number; totalUsd: number }>
  clusters: Cluster[]
  recentLiquidations: Array<{ price: number; quantity: number; usdValue: number; side: string; usdFormatted: string; timestamp: number }>
  range: { start: number; end: number; binSize: number }
}

// ── Helpers ────────────────────────────────────────────────

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr ?? '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ── Page ───────────────────────────────────────────────────

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'AVAX', 'LINK', 'ARB', 'OP']

export default function LiquidationsPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('BTC')
  const [tab, setTab] = useState<'heatmap' | 'clusters' | 'funding' | 'leaderboard'>('heatmap')
  const [binanceData, setBinanceData] = useState<BinanceHeatmapData | null>(null)

  // Hyperliquid data
  const { data: hlData, status: hlStatus, refresh } = useLiveFetch<LiquidationsResponse>({
    url: `/api/v1/liquidations?symbol=${selectedSymbol}`,
    interval: 30_000,
  })

  // Binance heatmap data
  const fetchBinance = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/liquidations/heatmap?symbol=${selectedSymbol}`)
      const d = await res.json()
      if (d.data) setBinanceData(d.data as BinanceHeatmapData)
    } catch { /* silent */ }
  }, [selectedSymbol])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
fetchBinance()
    const id = setInterval(fetchBinance, 10_000)
    return () => clearInterval(id)
  }, [fetchBinance])

  const spotlight = hlData?.spotlight ?? null
  const heatmap = hlData?.heatmap ?? []
  const fundingStrip = hlData?.fundingStrip ?? []
  const topPositions = hlData?.topPositions ?? []
  const leaderboard = hlData?.leaderboard ?? []
  const marketCount = hlData?.topPositions?.length ?? 0

  const totalLongLiq = heatmap.reduce((s, b) => s + b.longLiquidations, 0)
  const totalShortLiq = heatmap.reduce((s, b) => s + b.shortLiquidations, 0)
  const totalLiq = totalLongLiq + totalShortLiq
  const longDominance = totalLiq > 0 ? (totalLongLiq / totalLiq) * 100 : 50

  const maxDensity = binanceData ? Math.max(...binanceData.heatmap.map(b => b.density), 0.01) : 1

  const posColumns: Column<PositionEntry>[] = [
    { key: 'symbol', header: 'Pair', width: 80, render: r => (
      <button onClick={() => setSelectedSymbol(r.symbol)} className={`font-bold text-[11px] ${r.symbol === selectedSymbol ? 'text-teal-vivid' : 'text-text-primary hover:text-teal-vivid'} transition-colors`}>
        {r.symbol}
      </button>
    )},
    { key: 'price', header: 'Price', width: 100, align: 'right', render: r => <PriceTag value={r.price} size="sm" /> },
    { key: 'openInterest', header: 'OI', width: 100, align: 'right', render: r => <span className="text-text-primary font-mono text-[10px] tabular-nums">{formatUsd(r.openInterest * r.price)}</span> },
    { key: 'fundingRate', header: 'Funding', width: 80, align: 'right', render: r => (
      <span className={`font-mono text-[10px] tabular-nums ${r.fundingRate > 0 ? 'text-data-bear' : 'text-data-bull'}`}>
        {(r.fundingRate * 100).toFixed(4)}%
      </span>
    )},
    { key: 'maxLeverage', header: 'Max Lev', width: 60, align: 'right', render: r => <span className="text-text-secondary font-mono text-[10px]">{r.maxLeverage}×</span> },
  ]

  const lbColumns: Column<LeaderboardEntry>[] = [
    { key: 'address', header: 'Trader', width: 140, render: r => <span className="text-text-muted font-mono text-[10px]">{shortenAddress(r.address)}</span> },
    { key: 'pnl', header: 'PnL', width: 100, align: 'right', render: r => <span className={`font-mono text-[10px] tabular-nums ${r.pnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>{formatUsd(r.pnl)}</span> },
    { key: 'volume', header: 'Volume', width: 100, align: 'right', render: r => <span className="text-text-secondary font-mono text-[10px] tabular-nums">{formatUsd(r.volume)}</span> },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Liquidation Center</h1>
            <p className="text-[11px] text-text-muted font-mono">
              Hyperliquid + Binance • {marketCount} markets • Real-time heatmap
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-bg-raised p-1 rounded">
              {SYMBOLS.map(s => (
                <button key={s} onClick={() => setSelectedSymbol(s)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${selectedSymbol === s ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}>
                  {s}
                </button>
              ))}
            </div>
            <LiveDot status={hlStatus} label />
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1">
          {(['heatmap', 'clusters', 'funding', 'leaderboard'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-[11px] font-mono rounded uppercase transition-colors ${tab === t ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary bg-bg-raised'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-6 gap-1">
          <KPI label="Spot Price" value={spotlight ? `$${spotlight.price.toLocaleString()}` : '—'} />
          <KPI label="Mark Price" value={binanceData ? `$${binanceData.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'} />
          <KPI label="Open Interest" value={binanceData ? formatUsd(binanceData.openInterest * binanceData.currentPrice) : '—'} />
          <KPI label="Funding" value={binanceData ? `${(binanceData.fundingRate * 100).toFixed(4)}%` : '—'} color={binanceData && binanceData.fundingRate > 0 ? 'text-data-bear' : 'text-data-bull'} />
          <KPI label="Long Liq Zone" value={formatUsd(totalLongLiq)} color="text-data-bull" />
          <KPI label="Short Liq Zone" value={formatUsd(totalShortLiq)} color="text-data-bear" />
        </div>

        {/* ── TAB: Heatmap ── */}
        {tab === 'heatmap' && (
          <div className="space-y-3">
            {/* Binance Real Heatmap */}
            <Panel title={`Liquidation Heatmap — ${selectedSymbol}`} subtitle="Price levels ±20% • Real-time from Binance Futures" liveStatus={binanceData ? 'live' : 'stale'}>
              {binanceData && binanceData.heatmap.length > 0 ? (
                <div className="p-4 space-y-1 max-h-[500px] overflow-y-auto">
                  <div className="flex items-center justify-center mb-2">
                    <div className="px-3 py-1 bg-teal-vivid/20 border border-teal-vivid rounded text-[11px] font-mono font-bold text-teal-vivid">
                      Current: ${binanceData.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  {binanceData.heatmap
                    .filter(b => b.density > 0.001)
                    .sort((a, b) => b.priceLevel - a.priceLevel)
                    .map((bin, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-text-muted w-20 text-right tabular-nums">
                          ${bin.priceLevel.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                        <div className="flex-1 h-5 bg-bg-raised rounded relative overflow-hidden">
                          <div className="absolute left-0 top-0 h-full bg-data-bull/60 transition-all duration-300"
                            style={{ width: `${(bin.longLiquidations / (bin.longLiquidations + bin.shortLiquidations || 1)) * bin.density * 100}%` }} />
                          <div className="absolute right-0 top-0 h-full bg-data-bear/60 transition-all duration-300"
                            style={{ width: `${(bin.shortLiquidations / (bin.longLiquidations + bin.shortLiquidations || 1)) * bin.density * 100}%` }} />
                          {bin.density > 0.1 && (
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white font-bold drop-shadow-md">
                              {formatUsd(bin.totalUsd ?? 0)}
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] font-mono text-text-muted w-16 tabular-nums">
                          {bin.density > 0.01 ? `${(bin.density * 100).toFixed(0)}%` : ''}
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="p-8 text-text-muted text-[12px] font-mono text-center">Loading heatmap...</div>
              )}
            </Panel>

            {/* Hyperliquid Heatmap (grid style) */}
            <Panel title={`Hyperliquid Zones — ${selectedSymbol}`} subtitle="Estimated liquidation zones by leverage tier" liveStatus={hlStatus}>
              {heatmap.length > 0 && heatmap.some(b => b.density > 0) ? (
                <div className="p-2">
                  <div className="flex">
                    <div className="flex flex-col justify-between pr-2 shrink-0 w-16">
                      {[...heatmap].reverse().filter((_, i) => i % 5 === 0).map((bin, i) => (
                        <span key={i} className="text-[8px] font-mono text-text-muted tabular-nums text-right leading-none">
                          ${bin.priceLevel.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      ))}
                    </div>
                    <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(12px, 1fr))', gridTemplateRows: `repeat(${heatmap.length}, 18px)` }}>
                      {[...heatmap].reverse().map((bin, i) => {
                        const longD = bin.longLiquidations
                        const shortD = bin.shortLiquidations
                        const maxD = Math.max(longD, shortD, 1)
                        const intensity = Math.min(1, bin.density)
                        return (
                          <div key={i} className="rounded-sm transition-colors"
                            style={{
                              background: longD > shortD
                                ? `rgba(38, 166, 154, ${intensity * 0.7})`
                                : shortD > longD
                                ? `rgba(239, 83, 80, ${intensity * 0.7})`
                                : `rgba(100, 100, 100, ${intensity * 0.2})`,
                              borderLeft: longD > 0 ? '2px solid rgba(38, 166, 154, 0.4)' : undefined,
                              borderRight: shortD > 0 ? '2px solid rgba(239, 83, 80, 0.4)' : undefined,
                            }}
                            title={`$${bin.priceLevel.toFixed(0)} | L:${longD.toFixed(2)} S:${shortD.toFixed(2)} | Density:${(bin.density * 100).toFixed(0)}%`}
                          />
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-bg-border">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5 text-[9px] font-mono text-text-muted"><span className="w-3 h-3 rounded-sm bg-data-bull/60" />Long Liqs</span>
                      <span className="flex items-center gap-1.5 text-[9px] font-mono text-text-muted"><span className="w-3 h-3 rounded-sm bg-data-bear/60" />Short Liqs</span>
                    </div>
                    <span className="text-[8px] font-mono text-text-muted">{heatmap.length} bins</span>
                  </div>
                </div>
              ) : (
                <div className="text-text-muted text-[11px] p-4 text-center font-mono">Computing liquidation zones…</div>
              )}
            </Panel>
          </div>
        )}

        {/* ── TAB: Clusters ── */}
        {tab === 'clusters' && (
          <div className="space-y-3">
            <Panel title="Liquidation Clusters" subtitle="High-density zones from Binance" liveStatus={binanceData ? 'live' : 'stale'}>
              <div className="p-3 space-y-2">
                {(binanceData?.clusters ?? []).map((c, i) => (
                  <div key={i} className={`flex items-center justify-between p-3 rounded ${c.side === 'long' ? 'bg-data-bull/5 border border-data-bull/30' : 'bg-data-bear/5 border border-data-bear/30'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] font-mono font-bold ${c.side === 'long' ? 'text-data-bull' : 'text-data-bear'}`}>{c.side.toUpperCase()}</span>
                      <span className="text-[14px] font-mono font-bold text-text-primary tabular-nums">${c.priceLevel.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-text-muted">{c.distance}% away</span>
                      <span className="text-[13px] font-mono font-bold text-text-primary tabular-nums">{formatUsd(c.usdValue)}</span>
                    </div>
                  </div>
                ))}
                {(!binanceData?.clusters || binanceData.clusters.length === 0) && (
                  <div className="text-text-muted text-[11px] font-mono p-4 text-center">No clusters detected</div>
                )}
              </div>
            </Panel>

            <Panel title="Recent Liquidations" subtitle="Last 20 forced closes from Binance" liveStatus={binanceData ? 'live' : 'stale'}>
              <div className="p-3 space-y-1 max-h-[300px] overflow-y-auto">
                {(binanceData?.recentLiquidations ?? []).map((liq, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-bg-border/50">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${liq.side === 'long' ? 'bg-data-bear/20 text-data-bear' : 'bg-data-bull/20 text-data-bull'}`}>
                        {liq.side === 'long' ? 'LIQ LONG' : 'LIQ SHORT'}
                      </span>
                      <span className="text-[11px] font-mono text-text-primary tabular-nums">${liq.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-text-primary tabular-nums">{liq.usdFormatted}</span>
                  </div>
                ))}
                {(!binanceData?.recentLiquidations || binanceData.recentLiquidations.length === 0) && (
                  <div className="text-text-muted text-[11px] font-mono p-4 text-center">No liquidations in window</div>
                )}
              </div>
            </Panel>
          </div>
        )}

        {/* ── TAB: Funding ── */}
        {tab === 'funding' && (
          <Panel title="Funding Rates" subtitle={`${fundingStrip.length} active`} liveStatus={hlStatus} onRefresh={refresh}>
            <div className="p-3 grid grid-cols-4 gap-2">
              {fundingStrip.map(f => (
                <div key={f.symbol} className="bg-bg-raised p-3 rounded border border-bg-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-mono font-bold text-text-primary">{f.symbol}</span>
                    <span className={`text-[11px] font-mono font-bold ${f.rate > 0 ? 'text-data-bear' : 'text-data-bull'}`}>
                      {(f.rate * 100).toFixed(4)}%
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-text-muted">
                    Ann: {f.annualized.toFixed(1)}%
                  </div>
                </div>
              ))}
              {fundingStrip.length === 0 && (
                <div className="col-span-4 text-text-muted text-[11px] font-mono p-4 text-center">Loading funding data…</div>
              )}
            </div>
          </Panel>
        )}

        {/* ── TAB: Leaderboard ── */}
        {tab === 'leaderboard' && (
          <div className="grid grid-cols-2 gap-3">
            <Panel title="Top Positions by OI" subtitle="Click symbol to focus" liveStatus={hlStatus} maxHeight={500}>
              <DataTable
                columns={posColumns as unknown as Column<Record<string, unknown>>[]}
                data={topPositions as unknown as Record<string, unknown>[]}
                sortable rowHeight={28}
                emptyState={<div className="text-text-muted text-[11px] p-4 text-center font-mono">Loading positions…</div>}
              />
            </Panel>
            <Panel title="Hyperliquid Leaderboard" subtitle="Top traders by PnL" liveStatus={hlStatus} maxHeight={500}>
              <DataTable
                columns={lbColumns as unknown as Column<Record<string, unknown>>[]}
                data={leaderboard as unknown as Record<string, unknown>[]}
                sortable rowHeight={28}
                emptyState={<div className="text-text-muted text-[11px] p-4 text-center font-mono">Loading leaderboard…</div>}
              />
            </Panel>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border px-3 py-2 rounded">
      <div className="text-[9px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[14px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}
