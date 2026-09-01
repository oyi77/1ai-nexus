"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { TrendingUp, Target, Activity, BarChart3, Play } from 'lucide-react'

interface BacktestStats {
  totalSignals: number
  wins: number
  losses: number
  expired: number
  winRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxDrawdown: number
  avgDurationHours: number
}

interface BacktestResult {
  symbol: string
  direction: string
  entryPrice: number
  exitPrice: number | null
  outcome: 'win' | 'loss' | 'expired'
  pnlPercent: number | null
  hitTarget: string | null
  durationHours: number | null
  source: string
  backtestDate: string
}

const PERIODS = [7, 14, 30, 60, 90]

function formatPct(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function pnlColor(v: number | null): string {
  if (v === null) return 'text-zinc-400'
  return v >= 0 ? 'text-data-bull' : 'text-data-bear'
}

export default function BacktestPage() {
  const [stats, setStats] = useState<BacktestStats | null>(null)
  const [results, setResults] = useState<BacktestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(30)
  const [symbol, setSymbol] = useState<string | undefined>(undefined)

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ action: 'stats', period: String(period) })
        if (symbol) params.set('symbol', symbol)
        const res = await fetch(`/api/v1/backtest?${params}`)
        const d = await res.json()
        setStats(d.stats)
      } catch { /* ignore */ }
      setLoading(false)
    }
    fetchStats()
  }, [period, symbol])

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const params = new URLSearchParams({ action: 'results', period: String(period), limit: '50' })
        if (symbol) params.set('symbol', symbol)
        const res = await fetch(`/api/v1/backtest?${params}`)
        const d = await res.json()
        setResults(d.results || [])
      } catch { /* ignore */ }
    }
    fetchResults()
  }, [period, symbol])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">SIGNAL BACKTEST</h1>
            <p className="text-xs text-text-muted mt-1">
              Historical signal performance — real PnL from alpha + conviction signals
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {PERIODS.map(d => (
                <button key={d} onClick={() => setPeriod(d)}
                  className={`px-2 py-1 text-xs font-mono rounded ${
                    period === d ? 'bg-accent-cyan/20 text-accent-cyan' : 'text-text-muted hover:text-text-primary'
                  }`}>
                  {d}d
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Symbol (optional)"
              value={symbol || ''}
              onChange={e => setSymbol(e.target.value || undefined)}
              className="px-2 py-1 text-xs font-mono rounded bg-bg-raised border border-border-dim text-text-primary placeholder:text-text-muted w-28"
            />
            <LiveDot status={loading ? 'stale' : 'live'} label />
          </div>
        </div>

        {stats && stats.totalSignals > 0 && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">SIGNALS</p>
                <p className="text-2xl font-bold">{stats.totalSignals}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">WIN RATE</p>
                <p className={`text-2xl font-mono font-bold ${stats.winRate >= 60 ? 'text-data-bull' : stats.winRate < 40 ? 'text-data-bear' : 'text-text-muted'}`}>
                  {stats.winRate.toFixed(1)}%
                </p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">PROFIT FACTOR</p>
                <p className={`text-2xl font-bold ${stats.profitFactor >= 1.5 ? 'text-data-bull' : stats.profitFactor < 1 ? 'text-data-bear' : 'text-text-muted'}`}>
                  {stats.profitFactor.toFixed(2)}
                </p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">MAX DRAWDOWN</p>
                <p className="text-2xl font-bold text-data-bear">
                  {stats.maxDrawdown.toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Win/Loss breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">WINS</p>
                <p className="text-lg font-bold text-data-bull">{stats.wins}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">LOSSES</p>
                <p className="text-lg font-bold text-data-bear">{stats.losses}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">AVG WIN</p>
                <p className="text-lg font-bold text-data-bull">{formatPct(stats.avgWin)}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted">AVG LOSS</p>
                <p className="text-lg font-bold text-data-bear">{formatPct(stats.avgLoss)}</p>
              </div>
            </div>

            {/* Results table */}
            <Panel title="Signal Outcomes" subtitle={`${results.length} most recent`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <th className="text-left p-2">DATE</th>
                      <th className="text-left p-2">SYMBOL</th>
                      <th className="text-left p-2">DIRECTION</th>
                      <th className="text-right p-2">ENTRY</th>
                      <th className="text-right p-2">EXIT</th>
                      <th className="text-right p-2">PnL</th>
                      <th className="text-center p-2">OUTCOME</th>
                      <th className="text-left p-2">SOURCE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} className="border-b border-border-dim/50 hover:bg-bg-raised/50">
                        <td className="p-2 text-text-muted">{new Date(r.backtestDate).toLocaleDateString()}</td>
                        <td className="p-2 font-mono">{r.symbol}</td>
                        <td className="p-2">
                          <span className={r.direction === 'bullish' ? 'text-data-bull' : 'text-data-bear'}>
                            {r.direction}
                          </span>
                        </td>
                        <td className="p-2 text-right font-mono">${r.entryPrice.toFixed(2)}</td>
                        <td className="p-2 text-right font-mono">{r.exitPrice ? `$${r.exitPrice.toFixed(2)}` : '—'}</td>
                        <td className={`p-2 text-right font-mono font-bold ${pnlColor(r.pnlPercent)}`}>
                          {formatPct(r.pnlPercent)}
                        </td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            r.outcome === 'win' ? 'bg-data-bull/20 text-data-bull' :
                            r.outcome === 'loss' ? 'bg-data-bear/20 text-data-bear' :
                            'bg-text-muted/20 text-text-muted'
                          }`}>
                            {r.outcome.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-2 text-text-muted">{r.source}</td>
                      </tr>
                    ))}
                    {results.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-text-muted">
                          No signal outcomes yet. Signals are evaluated after price targets are hit or stop-loss is triggered.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}

        {stats && stats.totalSignals === 0 && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-8 text-center">
            <BarChart3 className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted">No backtest signals for this period yet.</p>
            <p className="text-xs text-text-dim mt-1">
              Signals accumulate as conviction and alpha signals are stored and evaluated.
            </p>
          </div>
        )}

        {!stats && !loading && (
          <div className="text-text-muted text-center py-8">Failed to load backtest data.</div>
        )}
      </div>
    </NexusLayout>
  )
}
