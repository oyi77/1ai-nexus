"use client"

import { useState, useMemo } from 'react'
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

interface SpotlightData {
  symbol: string
  price: number
  markPrice: number
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
  spotlight: SpotlightData | null
  heatmap: HeatmapBin[]
  fundingStrip: FundingEntry[]
  topPositions: PositionEntry[]
  leaderboard: LeaderboardEntry[]
}

// ── Helpers ───────────────────────────────────────────────

/** Map density 0–1 to a cool→hot CSS colour. */
function densityToColor(density: number, isLong: boolean): string {
  if (density < 0.01) return 'rgba(30, 33, 38, 0.4)'

  // Cool: #1d9e75 (teal-muted) → Hot: #F03D3D (bear red) through #F5A623 (warn amber)
  if (isLong) {
    // Longs: teal → amber → red intensity
    const r = Math.round(29 + density * (240 - 29))
    const g = Math.round(158 + density * (61 - 158))
    const b = Math.round(117 + density * (61 - 117))
    const a = 0.3 + density * 0.7
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`
  }
  // Shorts: purple → red
  const r = Math.round(155 + density * (240 - 155))
  const g = Math.round(110 + density * (61 - 110))
  const b = Math.round(245 + density * (61 - 245))
  const a = 0.3 + density * 0.7
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`
}

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ── Components ────────────────────────────────────────────

function FundingRateChip({ entry }: { entry: FundingEntry }) {
  const isPositive = entry.rate > 0
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono tabular-nums whitespace-nowrap ${
        isPositive ? 'bg-data-bear/10 text-data-bear' : 'bg-data-bull/10 text-data-bull'
      }`}
    >
      <span className="font-bold">{entry.symbol}</span>
      <span>{(entry.rate * 100).toFixed(4)}%</span>
    </span>
  )
}

function HeatmapCell({
  bin,
  maxPrice,
}: {
  bin: HeatmapBin
  maxPrice: number
}) {
  const totalLiq = bin.longLiquidations + bin.shortLiquidations
  const longRatio = totalLiq > 0 ? bin.longLiquidations / totalLiq : 0.5

  // Build a split-cell background: left = longs, right = shorts
  const longColor = densityToColor(bin.density * longRatio * 2, true)
  const shortColor = densityToColor(bin.density * (1 - longRatio) * 2, false)

  const pctFromSpot = maxPrice > 0
    ? ((bin.priceLevel - maxPrice) / maxPrice) * 100
    : 0

  return (
    <div
      className="relative group border border-bg-border/30 hover:border-teal-vivid/40 transition-colors cursor-default"
      style={{
        background: `linear-gradient(to right, ${longColor} 50%, ${shortColor} 50%)`,
        minHeight: 18,
      }}
    >
      {/* Density label on hover */}
      <div className="absolute inset-0 flex items-center justify-between px-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
        <span className="text-[7px] font-mono text-data-bull tabular-nums">
          {bin.longLiquidations > 0 ? bin.longLiquidations.toFixed(2) : ''}
        </span>
        <span className="text-[7px] font-mono text-text-muted tabular-nums">
          ${bin.priceLevel.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
        <span className="text-[7px] font-mono text-data-bear tabular-nums">
          {bin.shortLiquidations > 0 ? bin.shortLiquidations.toFixed(2) : ''}
        </span>
      </div>

      {/* Density indicator bar at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-teal-vivid/20"
        style={{ height: `${Math.max(1, bin.density * 100)}%` }}
      />

      {/* Spot price marker */}
      {Math.abs(pctFromSpot) < 0.5 && (
        <div className="absolute -left-1 top-0 bottom-0 w-0.5 bg-teal-vivid" />
      )}
    </div>
  )
}

function SpotMarker({ price, label }: { price: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-teal-vivid/10 border border-teal-vivid/30 rounded">
      <span className="w-1.5 h-1.5 rounded-full bg-teal-vivid animate-live-dot" />
      <span className="text-[9px] font-mono text-text-muted uppercase">{label}</span>
      <PriceTag value={price} size="sm" className="text-teal-vivid font-bold" />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────

export default function LiquidationsPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('BTC')

  const { data, status, refresh } = useLiveFetch<LiquidationsResponse>({
    url: `/api/v1/liquidations?symbol=${selectedSymbol}`,
    interval: 15_000,
    initialData: { spotlight: null, heatmap: [], fundingStrip: [], topPositions: [], leaderboard: [] },
  })

  const spotlight = data?.spotlight ?? null
  const heatmap = useMemo(() => data?.heatmap ?? [], [data])
  const fundingStrip = useMemo(() => data?.fundingStrip ?? [], [data])
  const topPositions = useMemo(() => data?.topPositions ?? [], [data])
  const leaderboard = useMemo(() => data?.leaderboard ?? [], [data])
  const marketCount = 0

  // Summary stats
  const totalLongLiq = useMemo(
    () => heatmap.reduce((s, b) => s + b.longLiquidations, 0),
    [heatmap],
  )
  const totalShortLiq = useMemo(
    () => heatmap.reduce((s, b) => s + b.shortLiquidations, 0),
    [heatmap],
  )
  const totalLiq = totalLongLiq + totalShortLiq
  const longDominance = totalLiq > 0 ? (totalLongLiq / totalLiq) * 100 : 50

  // Highest density bins
  const hotspots = useMemo(
    () => [...heatmap].sort((a, b) => b.density - a.density).slice(0, 3),
    [heatmap],
  )

  // Top positions table columns
  const posColumns: Column<PositionEntry>[] = [
    {
      key: 'symbol',
      header: 'Pair',
      width: 80,
      render: r => (
        <button
          onClick={() => setSelectedSymbol(r.symbol)}
          className={`font-bold text-[11px] ${
            r.symbol === selectedSymbol ? 'text-teal-vivid' : 'text-text-primary hover:text-teal-vivid'
          } transition-colors`}
        >
          {r.symbol}
        </button>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: 100,
      align: 'right',
      render: r => <PriceTag value={r.price} size="sm" />,
    },
    {
      key: 'openInterest',
      header: 'OI',
      width: 100,
      align: 'right',
      render: r => (
        <span className="text-text-primary font-mono text-[10px] tabular-nums">
          {formatUsd(r.openInterest * r.price)}
        </span>
      ),
    },
    {
      key: 'fundingRate',
      header: 'Funding',
      width: 80,
      align: 'right',
      render: r => (
        <span
          className={`font-mono text-[10px] tabular-nums ${
            r.fundingRate > 0 ? 'text-data-bear' : r.fundingRate < 0 ? 'text-data-bull' : 'text-text-muted'
          }`}
        >
          {r.fundingRate !== 0 ? `${(r.fundingRate * 100).toFixed(4)}%` : '—'}
        </span>
      ),
    },
    {
      key: 'maxLeverage',
      header: 'Max Lev',
      width: 70,
      align: 'right',
      render: r => (
        <span className="text-text-secondary font-mono text-[10px] tabular-nums">
          {r.maxLeverage > 0 ? `${r.maxLeverage}×` : '—'}
        </span>
      ),
    },
  ]

  // Leaderboard columns
  const lbColumns: Column<LeaderboardEntry>[] = [
    {
      key: 'address',
      header: 'Trader',
      width: 120,
      render: r => (
        <span className="text-teal-vivid font-mono text-[10px]">
          {shortenAddress(r.address)}
        </span>
      ),
    },
    {
      key: 'pnl',
      header: 'PnL',
      width: 100,
      align: 'right',
      render: r => (
        <span className={`font-mono text-[10px] tabular-nums ${r.pnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
          {formatUsd(r.pnl)}
        </span>
      ),
    },
    {
      key: 'volume',
      header: 'Volume',
      width: 100,
      align: 'right',
      render: r => (
        <span className="text-text-secondary font-mono text-[10px] tabular-nums">
          {formatUsd(r.volume)}
        </span>
      ),
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">
              Liquidation Heatmap
            </h1>
            <p className="text-[11px] text-text-muted font-mono">
              Hyperliquid {marketCount > 0 ? `· ${marketCount} markets` : ''} — estimated
              liquidation zones by leverage tier
            </p>
          </div>
          <div className="flex items-center gap-2">
            {spotlight && <SpotMarker price={spotlight.price} label={spotlight.symbol} />}
            <LiveDot status={status} label />
          </div>
        </div>

        {/* ── Funding Rate Strip ──────────────────────────── */}
        <Panel
          title="Funding Rates"
          subtitle={`${fundingStrip.length} active`}
          liveStatus={status}
          onRefresh={refresh}
        >
          <div className="flex gap-1.5 p-2 overflow-x-auto scrollbar-thin">
            {fundingStrip.length > 0
              ? fundingStrip.map(f => <FundingRateChip key={f.symbol} entry={f} />)
              : <span className="text-text-muted text-[10px] font-mono p-1">Loading funding data…</span>}
          </div>
        </Panel>

        {/* ── Summary Stats ───────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
          {[
            { l: 'Spot Price', v: spotlight ? <PriceTag value={spotlight.price} size="md" /> : '—' },
            { l: 'Long Liq Zone', v: <span className="text-data-bull tabular-nums">{formatUsd(totalLongLiq)}</span> },
            { l: 'Short Liq Zone', v: <span className="text-data-bear tabular-nums">{formatUsd(totalShortLiq)}</span> },
            {
              l: 'Long/Short Ratio',
              v: (
                <span className="tabular-nums">
                  <span className="text-data-bull">{longDominance.toFixed(0)}%</span>
                  <span className="text-text-muted mx-0.5">/</span>
                  <span className="text-data-bear">{(100 - longDominance).toFixed(0)}%</span>
                </span>
              ),
            },
            {
              l: 'Max Leverage',
              v: spotlight && spotlight.maxLeverage > 0
                ? <span className="text-text-primary">{spotlight.maxLeverage}×</span>
                : '—',
            },
          ].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">
                {k.l}
              </div>
              <div className="text-[16px] font-head font-bold text-text-primary tabular-nums">
                {k.v}
              </div>
            </div>
          ))}
        </div>

        {/* ── Hotspot Indicators ──────────────────────────── */}
        {hotspots.length > 0 && hotspots[0].density > 0 && (
          <div className="flex items-center gap-3 px-1">
            <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
              Hotspots:
            </span>
            {hotspots.map((h, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-data-bear/10 border border-data-bear/20"
              >
                <span className="w-1 h-1 rounded-full bg-data-bear animate-pulse" />
                <span className="text-[10px] font-mono text-data-bear tabular-nums">
                  ${h.priceLevel.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                <span className="text-[8px] font-mono text-text-muted">
                  {h.longLiquidations > 0 ? `L:${h.longLiquidations.toFixed(2)}` : ''}
                  {h.shortLiquidations > 0 ? ` S:${h.shortLiquidations.toFixed(2)}` : ''}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* ── Heatmap ────────────────────────────────────── */}
        <Panel
          title={`Liquidation Heatmap — ${spotlight?.symbol ?? '—'}`}
          subtitle="Price levels ±15% — left=longs, right=shorts"
          liveStatus={status}
          maxHeight={700}
        >
          {heatmap.length > 0 ? (
            <div className="p-2">
              {/* Y-axis labels + grid */}
              <div className="flex">
                {/* Price labels column */}
                <div className="flex flex-col justify-between pr-2 shrink-0 w-16">
                  {[...heatmap].reverse().filter((_, i) => i % 5 === 0).map((bin, i) => (
                    <span key={i} className="text-[8px] font-mono text-text-muted tabular-nums text-right leading-none">
                      ${bin.priceLevel.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  ))}
                </div>

                {/* Heatmap grid */}
                <div
                  className="flex-1 grid gap-px"
                  style={{
                    gridTemplateColumns: 'repeat(auto-fill, minmax(12px, 1fr))',
                    gridTemplateRows: `repeat(${heatmap.length}, 18px)`,
                  }}
                >
                  {[...heatmap].reverse().map((bin, i) => (
                    <HeatmapCell
                      key={i}
                      bin={bin}
                      maxPrice={spotlight?.price ?? 0}
                    />
                  ))}
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-bg-border">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ background: densityToColor(0.8, true) }} />
                    <span className="text-[9px] font-mono text-text-muted">Long Liqs</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ background: densityToColor(0.8, false) }} />
                    <span className="text-[9px] font-mono text-text-muted">Short Liqs</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-bg-raised" />
                    <span className="text-[9px] font-mono text-text-muted">Low Density</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-0.5 h-3 bg-teal-vivid" />
                    <span className="text-[9px] font-mono text-text-muted">Spot Price</span>
                  </div>
                </div>
                <span className="text-[8px] font-mono text-text-muted">
                  {heatmap.length} bins · est. from {LEVERAGE_TIERS_LABEL}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-text-muted text-[11px] p-4 text-center font-mono">
              {status === 'error' ? 'Failed to load data — check network' : 'Computing liquidation zones…'}
            </div>
          )}
        </Panel>

        {/* ── Bottom Grid: Positions + Leaderboard ────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel
            title="Top Positions by OI"
            subtitle="Click symbol to focus heatmap"
            liveStatus={status}
            maxHeight={400}
          >
            <DataTable
              columns={posColumns as unknown as Column<Record<string, unknown>>[]}
              data={topPositions as unknown as Record<string, unknown>[]}
              sortable
              rowHeight={28}
              emptyState={
                <div className="text-text-muted text-[11px] p-4 text-center font-mono">
                  Loading positions…
                </div>
              }
            />
          </Panel>

          <Panel
            title="Hyperliquid Leaderboard"
            subtitle="Top traders by PnL"
            liveStatus={status}
            maxHeight={400}
          >
            <DataTable
              columns={lbColumns as unknown as Column<Record<string, unknown>>[]}
              data={leaderboard as unknown as Record<string, unknown>[]}
              sortable
              rowHeight={28}
              emptyState={
                <div className="text-text-muted text-[11px] p-4 text-center font-mono">
                  Loading leaderboard…
                </div>
              }
            />
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}

const LEVERAGE_TIERS_LABEL = '2×, 3×, 5×, 10×, 20×, 50×, 75×, 100×'
