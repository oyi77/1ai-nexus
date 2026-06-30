"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface DerivSnapshot {
  exchange: string
  symbol: string
  fundingRate: number
  openInterest: number
  longShortRatio: number | null
  markPrice: number | null
  indexPrice: number | null
  timestamp: string
}

interface Liquidation {
  exchange: string
  symbol: string
  side: string
  quantity: number
  price: number
  estimatedValueUsd: number
  timestamp: string
}

interface Summary {
  avgFundingRate: number
  topFunding: Array<{ exchange: string; symbol: string; fundingRate: number }>
  totalOpenInterest: number
  btcFunding: number | null
  ethFunding: number | null
  btcOI: number | null
  ethOI: number | null
  btcLongShort: number | null
  exchangeCount: number
  symbolCount: number
}

function fmt(n: number | null, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(4)}%`
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

function fundingColor(rate: number): string {
  if (rate > 0.0005) return 'text-data-bear'
  if (rate < -0.0005) return 'text-data-bull'
  return 'text-text-muted'
}

export default function DerivativesIntelPage() {
  const [snapshots, setSnapshots] = useState<DerivSnapshot[]>([])
  const [liquidations, setLiquidations] = useState<Liquidation[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterExchange, setFilterExchange] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'funding' | 'oi' | 'lsr'>('funding')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [derivRes, liqRes] = await Promise.allSettled([
          fetch('/api/v1/derivatives-intel?action=all'),
          fetch('/api/v1/derivatives-intel?action=liquidations'),
        ])

        if (derivRes.status === 'fulfilled') {
          const d = await derivRes.value.json()
          if (d.data) {
            setSnapshots(d.data.snapshots ?? [])
            setSummary(d.data.summary ?? null)
          }
        }

        if (liqRes.status === 'fulfilled') {
          const d = await liqRes.value.json()
          if (d.data?.liquidations) setLiquidations(d.data.liquidations)
        }

        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [])

  const exchanges = useMemo(() => [...new Set(snapshots.map(s => s.exchange))], [snapshots])

  const filtered = useMemo(() => {
    let data = filterExchange === 'all' ? snapshots : snapshots.filter(s => s.exchange === filterExchange)
    switch (sortBy) {
      case 'funding': return [...data].sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate))
      case 'oi': return [...data].sort((a, b) => b.openInterest - a.openInterest)
      case 'lsr': return [...data].sort((a, b) => (b.longShortRatio ?? 0) - (a.longShortRatio ?? 0))
    }
  }, [snapshots, filterExchange, sortBy])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">DERIVATIVES INTELLIGENCE</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Binance, Bybit, OKX — funding rates, open interest, long/short ratios. Zero API keys.
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Summary Strip */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">BTC FUNDING</p>
              <p className={`text-lg font-mono font-bold ${fundingColor(summary.btcFunding ?? 0)}`}>{fmtPct(summary.btcFunding)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">ETH FUNDING</p>
              <p className={`text-lg font-mono font-bold ${fundingColor(summary.ethFunding ?? 0)}`}>{fmtPct(summary.ethFunding)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">BTC OI</p>
              <p className="text-lg font-mono font-bold">{summary.btcOI ? fmtUsd(summary.btcOI) : '—'}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">BTC L/S RATIO</p>
              <p className="text-lg font-mono font-bold">{summary.btcLongShort?.toFixed(3) ?? '—'}</p>
            </div>
          </div>
        )}

        {/* Top Funding Movers */}
        {summary && summary.topFunding.length > 0 && (
          <Panel title="Top Funding Movers" subtitle="Highest absolute funding rates">
            <div className="p-3 grid grid-cols-5 gap-2">
              {summary.topFunding.map((f, i) => (
                <div key={i} className="text-center p-2 border border-border-dim/30 rounded">
                  <p className="text-[10px] text-text-muted">{f.exchange}</p>
                  <p className="text-xs font-mono font-bold text-teal-vivid">{f.symbol.replace('USDT', '')}</p>
                  <p className={`text-sm font-mono font-bold ${fundingColor(f.fundingRate)}`}>{fmtPct(f.fundingRate)}</p>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-text-muted">Exchange:</span>
            {['all', ...exchanges].map(ex => (
              <button key={ex} onClick={() => setFilterExchange(ex)}
                className={`px-2 py-1 rounded ${filterExchange === ex ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>
                {ex === 'all' ? 'ALL' : ex}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-text-muted">Sort:</span>
            {([['funding', 'Funding'], ['oi', 'OI'], ['lsr', 'L/S']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setSortBy(key)}
                className={`px-2 py-1 rounded ${sortBy === key ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Derivatives Table */}
        <Panel title="Derivatives Snapshot" subtitle={`${filtered.length} pairs across ${exchanges.length} exchanges`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <th className="text-left py-2 px-2 font-mono">EXCHANGE</th>
                  <th className="text-left py-2 px-2 font-mono">SYMBOL</th>
                  <th className="text-right py-2 px-2 font-mono">FUNDING</th>
                  <th className="text-right py-2 px-2 font-mono">OI</th>
                  <th className="text-right py-2 px-2 font-mono">L/S</th>
                  <th className="text-right py-2 px-2 font-mono">MARK</th>
                  <th className="text-right py-2 px-2 font-mono">INDEX</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={`${s.exchange}-${s.symbol}-${i}`} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                    <td className="py-2 px-2 font-mono text-accent-cyan">{s.exchange}</td>
                    <td className="py-2 px-2 font-mono font-bold">{s.symbol.replace('USDT', '').replace('-USDT-SWAP', '')}</td>
                    <td className={`py-2 px-2 text-right font-mono font-bold ${fundingColor(s.fundingRate)}`}>{fmtPct(s.fundingRate)}</td>
                    <td className="py-2 px-2 text-right font-mono">{s.openInterest > 0 ? fmtUsd(s.openInterest) : '—'}</td>
                    <td className="py-2 px-2 text-right font-mono">{s.longShortRatio?.toFixed(3) ?? '—'}</td>
                    <td className="py-2 px-2 text-right font-mono">{s.markPrice ? fmt(s.markPrice) : '—'}</td>
                    <td className="py-2 px-2 text-right font-mono">{s.indexPrice ? fmt(s.indexPrice) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Recent Liquidations */}
        {liquidations.length > 0 && (
          <Panel title="Recent Liquidations" subtitle={`${liquidations.length} events`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 px-2 font-mono">TIME</th>
                    <th className="text-left py-2 px-2 font-mono">EXCHANGE</th>
                    <th className="text-left py-2 px-2 font-mono">SYMBOL</th>
                    <th className="text-right py-2 px-2 font-mono">SIDE</th>
                    <th className="text-right py-2 px-2 font-mono">QTY</th>
                    <th className="text-right py-2 px-2 font-mono">PRICE</th>
                    <th className="text-right py-2 px-2 font-mono">VALUE</th>
                  </tr>
                </thead>
                <tbody>
                  {liquidations.slice(0, 20).map((l, i) => (
                    <tr key={i} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 px-2 font-mono text-text-muted">{new Date(l.timestamp).toLocaleTimeString()}</td>
                      <td className="py-2 px-2 font-mono text-accent-cyan">{l.exchange}</td>
                      <td className="py-2 px-2 font-mono font-bold">{l.symbol.replace('USDT', '')}</td>
                      <td className={`py-2 px-2 text-right font-mono font-bold ${l.side === 'Buy' ? 'text-data-bull' : 'text-data-bear'}`}>{l.side}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmt(l.quantity, 4)}</td>
                      <td className="py-2 px-2 text-right font-mono">${fmt(l.price)}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtUsd(l.estimatedValueUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </NexusLayout>
  )
}
