"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface BacktestSignal {
  timestamp: string
  predicted: string
  actual: string
  confidence: number
  correct: boolean
  priceChange: number | null
}

interface BacktestResult {
  module: string
  totalSignals: number
  correctPredictions: number
  accuracy: number
  avgConfidence: number
  signals: BacktestSignal[]
}

interface BacktestReport {
  period: { from: string; to: string }
  modules: BacktestResult[]
  overall: { totalSignals: number; totalCorrect: number; accuracy: number }
  timestamp: string
}

export default function BacktestPage() {
  const [report, setReport] = useState<BacktestReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/v1/backtest?days=${days}`)
        const d = await res.json()
        if (d.data) setReport(d.data)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
  }, [days])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">SIGNAL BACKTEST</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Historical signal accuracy — predicted vs actual BTC price movement
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {[7, 14, 30, 60].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`px-2 py-1 text-xs font-mono rounded ${
                    days === d ? 'bg-accent-cyan/20 text-accent-cyan' : 'text-text-muted hover:text-text-primary'
                  }`}>
                  {d}d
                </button>
              ))}
            </div>
            <LiveDot status={loading ? 'stale' : 'live'} label />
          </div>
        </div>

        {report && (
          <>
            {/* Overall summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-center">
                <p className="text-[10px] text-text-muted font-mono">TOTAL SIGNALS</p>
                <p className="text-2xl font-mono font-bold">{report.overall.totalSignals}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-center">
                <p className="text-[10px] text-text-muted font-mono">CORRECT</p>
                <p className="text-2xl font-mono font-bold text-data-bull">{report.overall.totalCorrect}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-center">
                <p className="text-[10px] text-text-muted font-mono">ACCURACY</p>
                <p className={`text-2xl font-mono font-bold ${
                  report.overall.accuracy > 60 ? 'text-data-bull' : report.overall.accuracy < 40 ? 'text-data-bear' : 'text-text-muted'
                }`}>
                  {report.overall.accuracy.toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Per-module results */}
            {report.modules.map((mod, i) => (
              <Panel key={i} title={mod.module} subtitle={`${mod.totalSignals} signals, ${mod.accuracy.toFixed(1)}% accuracy`}>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] text-text-muted font-mono">ACCURACY</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-bg-raised rounded overflow-hidden">
                          <div
                            className={`h-full ${mod.accuracy > 60 ? 'bg-data-bull' : mod.accuracy < 40 ? 'bg-data-bear' : 'bg-text-muted'}`}
                            style={{ width: `${mod.accuracy}%` }}
                          />
                        </div>
                        <span className="text-sm font-mono font-bold">{mod.accuracy.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted font-mono">AVG CONFIDENCE</p>
                      <p className="text-sm font-mono font-bold">{mod.avgConfidence.toFixed(0)}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted font-mono">HIT RATE</p>
                      <p className="text-sm font-mono font-bold">{mod.correctPredictions}/{mod.totalSignals}</p>
                    </div>
                  </div>

                  {/* Recent signals */}
                  {mod.signals.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-text-muted border-b border-border-dim">
                            <th className="text-left py-1 px-2 font-mono">TIME</th>
                            <th className="text-left py-1 px-2 font-mono">PREDICTED</th>
                            <th className="text-left py-1 px-2 font-mono">ACTUAL</th>
                            <th className="text-right py-1 px-2 font-mono">CONF</th>
                            <th className="text-right py-1 px-2 font-mono">PRICE Δ</th>
                            <th className="text-left py-1 px-2 font-mono">RESULT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mod.signals.slice(-10).map((sig, j) => (
                            <tr key={j} className="border-b border-border-dim/30">
                              <td className="py-1 px-2 font-mono text-text-dim">{new Date(sig.timestamp).toLocaleDateString()}</td>
                              <td className={`py-1 px-2 font-mono ${sig.predicted === 'bullish' ? 'text-data-bull' : sig.predicted === 'bearish' ? 'text-data-bear' : 'text-text-muted'}`}>
                                {sig.predicted}
                              </td>
                              <td className={`py-1 px-2 font-mono ${sig.actual === 'bullish' ? 'text-data-bull' : sig.actual === 'bearish' ? 'text-data-bear' : 'text-text-muted'}`}>
                                {sig.actual}
                              </td>
                              <td className="py-1 px-2 text-right font-mono">{sig.confidence.toFixed(0)}%</td>
                              <td className={`py-1 px-2 text-right font-mono ${sig.priceChange && sig.priceChange > 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                                {sig.priceChange ? `${sig.priceChange > 0 ? '+' : ''}${sig.priceChange.toFixed(2)}%` : '—'}
                              </td>
                              <td className="py-1 px-2">
                                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                                  sig.correct ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                                }`}>
                                  {sig.correct ? 'HIT' : 'MISS'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {mod.signals.length === 0 && (
                    <div className="text-text-muted text-[11px] text-center py-2">
                      No historical signals with price outcomes yet — data accumulates over time
                    </div>
                  )}
                </div>
              </Panel>
            ))}

            <div className="text-[10px] text-text-dim text-center font-mono">
              Period: {new Date(report.period.from).toLocaleDateString()} — {new Date(report.period.to).toLocaleDateString()} | 
              Signals compared against BTC price movement 24h after prediction
            </div>
          </>
        )}
      </div>
    </NexusLayout>
  )
}
