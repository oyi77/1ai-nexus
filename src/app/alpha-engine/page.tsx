"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface AlphaSignal {
  id: string
  symbol: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  sources: string[]
  reasoning: string
  timestamp: number
}

interface Prediction {
  id: string
  symbol: string
  direction: 'long' | 'short'
  entryPrice: number
  targetPrice?: number
  stopLoss?: number
  confidence: number
  source: string
  reasoning: string
  timestamp: number
  status: 'open' | 'closed'
  exitPrice?: number
  pnlPercent?: number
  outcome?: string
}

interface Accuracy {
  total: number
  wins: number
  losses: number
  winRate: number
  avgPnl: number
}

export default function AlphaEnginePage() {
  const [signals, setSignals] = useState<AlphaSignal[]>([])
  const [predictions, setPredictions] = useState<{ open: Prediction[]; closed: Prediction[]; accuracy: Accuracy }>({ open: [], closed: [], accuracy: { total: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0 } })
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [tab, setTab] = useState<'signals' | 'predictions' | 'accuracy'>('signals')

  const fetchData = useCallback(async () => {
    try {
      const [alphaRes, predRes] = await Promise.allSettled([
        fetch('/api/v1/alpha-engine').then(r => r.json()),
        fetch('/api/v1/paper-trading').then(r => r.json()),
      ])

      if (alphaRes.status === 'fulfilled' && alphaRes.value?.data) {
        setSignals(alphaRes.value.data.signals ?? alphaRes.value.data ?? [])
      }
      if (predRes.status === 'fulfilled' && predRes.value?.data) {
        setPredictions(predRes.value.data)
      }
      setStatus('live')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  const acc = predictions.accuracy

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">🧠</span> Alpha Engine
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Cross-correlated signals from trade flow, whale alerts, funding rates, and sentiment.
              Paper trading predictions tracked over time.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-6 gap-2">
          <KPI label="Active Signals" value={String(signals.length)} />
          <KPI label="Open Predictions" value={String(predictions.open.length)} />
          <KPI label="Total Closed" value={String(acc.total)} />
          <KPI label="Win Rate" value={`${acc.winRate.toFixed(1)}%`} color={acc.winRate > 50 ? 'text-data-bull' : acc.winRate > 0 ? 'text-data-bear' : 'text-text-muted'} />
          <KPI label="Avg PnL" value={`${acc.avgPnl > 0 ? '+' : ''}${acc.avgPnl.toFixed(2)}%`} color={acc.avgPnl >= 0 ? 'text-data-bull' : 'text-data-bear'} />
          <KPI label="W / L" value={`${acc.wins} / ${acc.losses}`} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {(['signals', 'predictions', 'accuracy'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-[11px] font-mono rounded uppercase transition-colors ${tab === t ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary bg-bg-raised'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'signals' && (
          <Panel title="Alpha Signals" subtitle={`${signals.length} cross-correlated signals`} liveStatus={status} onRefresh={fetchData}>
            <div className="space-y-1 p-2">
              {signals.map((s, i) => (
                <div key={i} className="flex items-start gap-3 py-2 px-3 border-b border-bg-border/50 hover:bg-bg-raised transition-colors">
                  <span className={`text-[16px] mt-0.5 ${s.direction === 'bullish' ? 'text-data-bull' : s.direction === 'bearish' ? 'text-data-bear' : 'text-text-muted'}`}>
                    {s.direction === 'bullish' ? '🟢' : s.direction === 'bearish' ? '🔴' : '⚪'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-mono font-bold text-teal-vivid">{s.symbol}</span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        s.direction === 'bullish' ? 'bg-data-bull/20 text-data-bull' :
                        s.direction === 'bearish' ? 'bg-data-bear/20 text-data-bear' :
                        'bg-bg-raised text-text-muted'
                      }`}>
                        {s.direction.toUpperCase()}
                      </span>
                      {s.sources.map((src, j) => (
                        <span key={j} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted">{src}</span>
                      ))}
                    </div>
                    <div className="text-[11px] text-text-secondary mt-1">{s.reasoning}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-text-muted">STR</span>
                      <span className="text-[12px] font-mono font-bold text-text-primary">{s.strength}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-text-muted">CONF</span>
                      <span className="text-[12px] font-mono font-bold text-text-primary">{s.confidence}%</span>
                    </div>
                    <span className="text-[9px] font-mono text-text-muted">{new Date(s.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="p-8 text-center text-text-muted text-[12px] font-mono">Alpha engine is warming up...</div>
              )}
            </div>
          </Panel>
        )}

        {tab === 'predictions' && (
          <div className="space-y-4">
            <Panel title="Open Predictions" subtitle={`${predictions.open.length} active paper trades`} liveStatus={status}>
              <div className="space-y-1 p-2">
                {predictions.open.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 px-3 border-b border-bg-border/50">
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      p.direction === 'long' ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                    }`}>
                      {p.direction.toUpperCase()}
                    </span>
                    <span className="text-[12px] font-mono font-bold text-teal-vivid">{p.symbol}</span>
                    <span className="text-[11px] font-mono text-text-primary tabular-nums">Entry: ${p.entryPrice.toLocaleString()}</span>
                    {p.targetPrice && <span className="text-[11px] font-mono text-data-bull tabular-nums">Target: ${p.targetPrice.toLocaleString()}</span>}
                    {p.stopLoss && <span className="text-[11px] font-mono text-data-bear tabular-nums">SL: ${p.stopLoss.toLocaleString()}</span>}
                    <span className="text-[10px] font-mono text-text-muted">Conf: {p.confidence}%</span>
                    <span className="text-[9px] font-mono text-text-muted ml-auto">{p.source}</span>
                  </div>
                ))}
                {predictions.open.length === 0 && (
                  <div className="p-4 text-center text-text-muted text-[11px] font-mono">No open predictions</div>
                )}
              </div>
            </Panel>

            <Panel title="Closed Predictions" subtitle={`${predictions.closed.length} completed trades`} liveStatus={status}>
              <div className="space-y-1 p-2 max-h-[300px] overflow-y-auto">
                {predictions.closed.slice(0, 20).map((p, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 px-3 border-b border-bg-border/50">
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      p.outcome === 'win' ? 'bg-data-bull/20 text-data-bull' :
                      p.outcome === 'loss' ? 'bg-data-bear/20 text-data-bear' :
                      'bg-bg-raised text-text-muted'
                    }`}>
                      {p.outcome?.toUpperCase()}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-teal-vivid">{p.symbol}</span>
                    <span className="text-[11px] font-mono text-text-primary tabular-nums">${p.entryPrice.toLocaleString()} → ${p.exitPrice?.toLocaleString()}</span>
                    <span className={`text-[11px] font-mono font-bold tabular-nums ${(p.pnlPercent ?? 0) >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {(p.pnlPercent ?? 0) > 0 ? '+' : ''}{(p.pnlPercent ?? 0).toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {tab === 'accuracy' && (
          <Panel title="Prediction Accuracy" subtitle="Paper trading performance over time" liveStatus={status}>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-[48px] font-head font-bold text-teal-vivid tabular-nums">{acc.winRate.toFixed(1)}%</div>
                  <div className="text-[12px] font-mono text-text-muted">Win Rate</div>
                </div>
                <div className="text-center">
                  <div className={`text-[48px] font-head font-bold tabular-nums ${acc.avgPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                    {acc.avgPnl > 0 ? '+' : ''}{acc.avgPnl.toFixed(2)}%
                  </div>
                  <div className="text-[12px] font-mono text-text-muted">Average PnL</div>
                </div>
                <div className="text-center">
                  <div className="text-[48px] font-head font-bold text-text-primary tabular-nums">{acc.total}</div>
                  <div className="text-[12px] font-mono text-text-muted">Total Predictions</div>
                </div>
              </div>
              <div className="flex items-center justify-center gap-8">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-data-bull" />
                  <span className="text-[12px] font-mono text-text-primary">{acc.wins} Wins</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-data-bear" />
                  <span className="text-[12px] font-mono text-text-primary">{acc.losses} Losses</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-text-muted" />
                  <span className="text-[12px] font-mono text-text-primary">{acc.total - acc.wins - acc.losses} Breakeven</span>
                </div>
              </div>
            </div>
          </Panel>
        )}
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