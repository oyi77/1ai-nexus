"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

// ─── Types ──────────────────────────────────────────────────

interface MaxPainItem {
  expiry: string
  expiryTimestamp: number
  daysToExpiry: number
  maxPainStrike: number
  currentPrice: number
  distance: number
  signal: 'above' | 'below' | 'at'
  totalPainAtMax: number
  strikes: Array<{
    strike: number
    totalPain: number
    callPain: number
    putPain: number
  }>
}

interface TermStructureItem {
  asset: string
  currentQuarter: { label: string; price: number } | null
  nextQuarter: { label: string; price: number } | null
  spotIndex: number
  annualizedBasis: number
  regime: 'contango' | 'backwardation' | 'flat'
  signal: 'bullish' | 'bearish' | 'neutral'
}

interface FundingEntry {
  exchange: string
  symbol: string
  fundingRate: number
  annualized: number
  magnitude: 'extreme' | 'high' | 'moderate' | 'low'
  direction: 'longs_pay' | 'shorts_pay' | 'neutral'
}

interface OptionsIntelData {
  maxPain: MaxPainItem[]
  termStructure: TermStructureItem[]
  fundingHeatmap: FundingEntry[]
  timestamp: string
}

// ─── Helpers ────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`
}

function fundingColor(entry: FundingEntry): string {
  if (entry.magnitude === 'extreme') return entry.direction === 'longs_pay' ? '#ff5630' : '#36b37e'
  if (entry.magnitude === 'high') return entry.direction === 'longs_pay' ? '#ff8f73' : '#57d9a3'
  if (entry.magnitude === 'moderate') return entry.direction === 'longs_pay' ? '#ffbdad' : '#abf5d1'
  return '#6b778c'
}

function regimeColor(regime: string): string {
  if (regime === 'contango') return '#36b37e'
  if (regime === 'backwardation') return '#ff5630'
  return '#6b778c'
}

function signalEmoji(signal: string): string {
  if (signal === 'bullish') return '🟢'
  if (signal === 'bearish') return '🔴'
  return '⚪'
}

// ─── Max Pain Mini Chart ────────────────────────────────────

function MaxPainChart({ item }: { item: MaxPainItem }) {
  if (!item.strikes.length) return null

  const maxPain = Math.max(...item.strikes.map(s => s.totalPain))
  const maxStrike = Math.max(...item.strikes.map(s => s.strike))
  const minStrike = Math.min(...item.strikes.map(s => s.strike))
  const range = maxStrike - minStrike || 1

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-mono font-bold text-accent-cyan">{item.expiry}</span>
          <span className="text-[10px] text-text-dim ml-2">({item.daysToExpiry}d)</span>
        </div>
        <div className="text-right">
          <span className="text-[11px] font-mono text-text-secondary">
            Max Pain: <span className="text-accent-amber font-bold">{fmtPrice(item.maxPainStrike)}</span>
          </span>
        </div>
      </div>

      {/* SVG bar chart */}
      <div className="h-24 w-full relative">
        <svg width="100%" height="100%" viewBox="0 0 400 96" preserveAspectRatio="none">
          {item.strikes.map((s, i) => {
            const x = ((s.strike - minStrike) / range) * 396 + 2
            const h = maxPain > 0 ? (s.totalPain / maxPain) * 88 : 0
            const isMaxPain = s.strike === item.maxPainStrike
            return (
              <rect
                key={i}
                x={x}
                y={96 - h}
                width={Math.max(2, 396 / item.strikes.length - 1)}
                height={h}
                fill={isMaxPain ? '#ff8b00' : s.strike === item.currentPrice ? '#00b8d9' : '#4c566a'}
                opacity={isMaxPain ? 1 : 0.6}
              />
            )
          })}
          {/* Current price line */}
          {(() => {
            const x = ((item.currentPrice - minStrike) / range) * 396 + 2
            return (
              <line x1={x} y1={0} x2={x} y2={96} stroke="#00b8d9" strokeWidth={1.5} strokeDasharray="4,2" />
            )
          })()}
        </svg>
        {/* Labels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[8px] text-text-dim font-mono px-1">
          <span>{fmtPrice(minStrike)}</span>
          <span>{fmtPrice(maxStrike)}</span>
        </div>
      </div>

      {/* Current vs Max Pain */}
      <div className="flex items-center gap-4 text-[10px] font-mono">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-accent-cyan inline-block" />
          <span className="text-text-muted">Spot: {fmtPrice(item.currentPrice)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-accent-amber inline-block" />
          <span className="text-text-muted">Max Pain: {fmtPrice(item.maxPainStrike)}</span>
        </div>
        <span className={`font-bold ${item.signal === 'above' ? 'text-data-bull' : item.signal === 'below' ? 'text-data-bear' : 'text-text-dim'}`}>
          {item.distance > 0 ? '+' : ''}{item.distance}%
        </span>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────

export default function OptionsIntelPage() {
  const [data, setData] = useState<OptionsIntelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/options-intel?action=all')
      const json = await res.json()
      if (json.data) {
        setData(json.data)
        setError(null)
      } else {
        setError(json.error ?? 'Failed to fetch')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
fetchData()
    const interval = setInterval(fetchData, 120_000) // refresh every 2 min
    return () => clearInterval(interval)
  }, [fetchData])

  // Group funding heatmap by symbol for display
  const fundingBySymbol = new Map<string, FundingEntry[]>()
  if (data?.fundingHeatmap) {
    for (const entry of data.fundingHeatmap) {
      const existing = fundingBySymbol.get(entry.symbol) ?? []
      existing.push(entry)
      fundingBySymbol.set(entry.symbol, existing)
    }
  }

  // Top 15 unique symbols for the heatmap
  const topSymbols = Array.from(fundingBySymbol.entries())
    .sort((a, b) => {
      const maxA = Math.max(...a[1].map(e => Math.abs(e.annualized)))
      const maxB = Math.max(...b[1].map(e => Math.abs(e.annualized)))
      return maxB - maxA
    })
    .slice(0, 15)

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">OPTIONS INTEL</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Deribit options max pain, futures term structure, cross-exchange funding heatmap — all public APIs
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
        </div>

        {error && !data && (
          <div className="bg-data-bear/10 border border-data-bear/30 rounded-lg p-3 text-xs text-data-bear font-mono">
            {error}
          </div>
        )}

        {/* ─── Signal Summary Cards ─────────────────────────── */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.termStructure.map((ts) => (
              <div key={ts.asset} className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-[10px] text-text-muted font-mono">{ts.asset} TERM STRUCTURE</p>
                <p className="text-lg font-mono font-bold" style={{ color: regimeColor(ts.regime) }}>
                  {ts.regime.toUpperCase()}
                </p>
                <p className="text-[10px] font-mono text-text-dim">
                  {ts.annualizedBasis > 0 ? '+' : ''}{ts.annualizedBasis}% annualized
                </p>
                <p className="text-[10px] font-mono mt-1">{signalEmoji(ts.signal)} {ts.signal}</p>
              </div>
            ))}

            {data.maxPain.length > 0 && (
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-[10px] text-text-muted font-mono">BTC MAX PAIN (NEAREST)</p>
                <p className="text-lg font-mono font-bold text-accent-amber">
                  {fmtPrice(data.maxPain[0]?.maxPainStrike ?? 0)}
                </p>
                <p className="text-[10px] font-mono text-text-dim">
                  Spot: {fmtPrice(data.maxPain[0]?.currentPrice ?? 0)}
                </p>
                <p className={`text-[10px] font-mono mt-1 ${data.maxPain[0]?.signal === 'above' ? 'text-data-bull' : 'text-data-bear'}`}>
                  {data.maxPain[0]?.distance > 0 ? '+' : ''}{data.maxPain[0]?.distance ?? 0}% to max pain
                </p>
              </div>
            )}

            {data.fundingHeatmap.length > 0 && (
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-[10px] text-text-muted font-mono">FUNDING SIGNAL</p>
                <p className="text-lg font-mono font-bold">
                  {data.fundingHeatmap.filter(e => e.direction === 'longs_pay').length > data.fundingHeatmap.filter(e => e.direction === 'shorts_pay').length
                    ? <span className="text-data-bull">LONGS PAYING</span>
                    : data.fundingHeatmap.filter(e => e.direction === 'shorts_pay').length > data.fundingHeatmap.filter(e => e.direction === 'longs_pay').length
                      ? <span className="text-data-bear">SHORTS PAYING</span>
                      : <span className="text-text-dim">NEUTRAL</span>
                  }
                </p>
                <p className="text-[10px] font-mono text-text-dim">
                  {data.fundingHeatmap.filter(e => e.magnitude === 'extreme').length} extreme rates
                </p>
              </div>
            )}
          </div>
        )}

        {/* ─── Max Pain Charts ──────────────────────────────── */}
        <Panel
          title="Options Max Pain"
          subtitle="Strike with minimum total option value — price gravitates here at expiry"
          liveStatus={loading ? 'stale' : 'live'}
        >
          {!data || data.maxPain.length === 0 ? (
            <div className="text-text-muted text-[11px] p-4 text-center">
              {loading ? 'Loading options data...' : 'No max pain data available'}
            </div>
          ) : (
            <div className="p-4 space-y-6">
              {data.maxPain.map((mp) => (
                <MaxPainChart key={`${mp.expiry}-${mp.expiryTimestamp}`} item={mp} />
              ))}
            </div>
          )}
        </Panel>

        {/* ─── Term Structure ───────────────────────────────── */}
        <Panel
          title="Futures Term Structure"
          subtitle="Contango = bullish, backwardation = bearish"
          liveStatus={loading ? 'stale' : 'live'}
        >
          {!data || data.termStructure.length === 0 ? (
            <div className="text-text-muted text-[11px] p-4 text-center">
              {loading ? 'Loading term structure...' : 'No term structure data'}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {data.termStructure.map((ts) => (
                <div key={ts.asset} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono font-bold text-accent-cyan">{ts.asset}</span>
                    <span
                      className="text-[11px] font-mono font-bold px-2 py-0.5 rounded"
                      style={{
                        color: regimeColor(ts.regime),
                        backgroundColor: `${regimeColor(ts.regime)}20`,
                      }}
                    >
                      {ts.regime.toUpperCase()} {signalEmoji(ts.signal)}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-[11px] font-mono">
                    <div className="bg-bg-raised rounded p-2">
                      <p className="text-text-dim text-[9px]">SPOT INDEX</p>
                      <p className="font-bold">{fmtPrice(ts.spotIndex)}</p>
                    </div>
                    {ts.currentQuarter && (
                      <div className="bg-bg-raised rounded p-2">
                        <p className="text-text-dim text-[9px]">CURRENT Q</p>
                        <p className="font-bold">{fmtPrice(ts.currentQuarter.price)}</p>
                        <p className="text-[9px] text-text-dim truncate">{ts.currentQuarter.label}</p>
                      </div>
                    )}
                    {ts.nextQuarter && (
                      <div className="bg-bg-raised rounded p-2">
                        <p className="text-text-dim text-[9px]">NEXT Q</p>
                        <p className="font-bold">{fmtPrice(ts.nextQuarter.price)}</p>
                        <p className="text-[9px] text-text-dim truncate">{ts.nextQuarter.label}</p>
                      </div>
                    )}
                  </div>

                  <div className="text-[10px] font-mono text-text-secondary">
                    Annualized basis: <span className="font-bold" style={{ color: ts.annualizedBasis > 0 ? '#36b37e' : ts.annualizedBasis < 0 ? '#ff5630' : '#6b778c' }}>
                      {ts.annualizedBasis > 0 ? '+' : ''}{ts.annualizedBasis}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ─── Funding Rate Heatmap ─────────────────────────── */}
        <Panel
          title="Funding Rate Heatmap"
          subtitle="Cross-exchange perpetual funding — color by magnitude"
          liveStatus={loading ? 'stale' : 'live'}
        >
          {!data || topSymbols.length === 0 ? (
            <div className="text-text-muted text-[11px] p-4 text-center">
              {loading ? 'Loading funding rates...' : 'No funding data'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 px-2 font-mono sticky left-0 bg-bg-panel">PAIR</th>
                    <th className="text-center py-2 px-2 font-mono">BINANCE</th>
                    <th className="text-center py-2 px-2 font-mono">BYBIT</th>
                    <th className="text-center py-2 px-2 font-mono">OKX</th>
                    <th className="text-center py-2 px-2 font-mono">SIGNAL</th>
                  </tr>
                </thead>
                <tbody>
                  {topSymbols.map(([symbol, entries]) => {
                    const byExchange = new Map(entries.map(e => [e.exchange, e]))
                    const binance = byExchange.get('Binance')
                    const bybit = byExchange.get('Bybit')
                    const okx = byExchange.get('OKX')

                    // Dominant signal from highest magnitude entry
                    const dominant = entries.reduce((max, e) =>
                      Math.abs(e.annualized) > Math.abs(max.annualized) ? e : max
                    , entries[0])

                    return (
                      <tr key={symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 px-2 font-mono font-bold text-text-primary sticky left-0 bg-bg-panel">
                          {symbol.replace('USDT', '')}
                        </td>
                        {[binance, bybit, okx].map((entry, i) => (
                          <td key={i} className="py-2 px-2 text-center font-mono">
                            {entry ? (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                                style={{
                                  color: fundingColor(entry),
                                  backgroundColor: `${fundingColor(entry)}15`,
                                }}
                              >
                                {fmtRate(entry.fundingRate)}
                              </span>
                            ) : (
                              <span className="text-text-dim">—</span>
                            )}
                          </td>
                        ))}
                        <td className="py-2 px-2 text-center text-[10px] font-mono">
                          <span style={{ color: fundingColor(dominant) }}>
                            {dominant.direction === 'longs_pay' ? '↑ L pay' : dominant.direction === 'shorts_pay' ? '↓ S pay' : '— neutral'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ─── Signal Guide ─────────────────────────────────── */}
        <Panel title="Signal Guide" subtitle="How to interpret these derivatives indicators">
          <div className="p-4 space-y-4 text-[11px] font-mono text-text-secondary leading-relaxed">
            <div>
              <p className="text-accent-amber font-bold mb-1">MAX PAIN</p>
              <p>
                The strike price where the total value of outstanding options is minimized — option holders
                collectively lose the most and writers (market makers) profit most. Price tends to gravitate
                toward max pain as expiry approaches due to delta hedging by MMs. When spot is above max pain,
                expect downward pressure; below max pain, expect upward pressure.
              </p>
            </div>
            <div>
              <p className="text-accent-cyan font-bold mb-1">TERM STRUCTURE</p>
              <p>
                Compares near-quarter vs next-quarter Deribit futures. <span className="text-data-bull">Contango</span> (next quarter
                premium) signals bullish sentiment and healthy demand for leverage longs. <span className="text-data-bear">Backwardation</span> (next
                quarter discount) signals bearish positioning or deleveraging. Annualized basis above 20% = overheated;
                below -10% = capitulation signal.
              </p>
            </div>
            <div>
              <p className="text-accent-green font-bold mb-1">FUNDING HEATMAP</p>
              <p>
                Perpetual funding rates across Binance, Bybit, and OKX. When longs pay shorts (positive rate),
                the market is net long — extreme readings ({'>'}0.1% per 8h) often precede squeezes. When shorts pay
                longs (negative rate), the market is net short. Divergence between exchanges signals arbitrage
                opportunities and liquidity imbalances.
              </p>
            </div>
          </div>
        </Panel>

        {/* Timestamp */}
        {data?.timestamp && (
          <p className="text-[10px] text-text-dim font-mono text-right">
            Last updated: {new Date(data.timestamp).toLocaleString()}
          </p>
        )}
      </div>
    </NexusLayout>
  )
}
