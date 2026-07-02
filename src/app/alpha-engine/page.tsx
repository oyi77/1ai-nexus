"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { FinancialDisclaimer } from '@/components/FinancialDisclaimer'

type ValidPeriod = '4h' | '24h' | '7d'

interface AlphaSignal {
  id: string
  symbol: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  sources: string[]
  reasoning: string
  timestamp: number
  // Trading levels
  entry: number | null
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  validPeriod: ValidPeriod
  expiresAt: number
}

interface SignalHistory {
  id: string
  symbol: string
  direction: string
  entry: number
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  status: 'active' | 'completed'
  outcome: 'win' | 'loss' | 'expired' | null
  exitPrice: number | null
  pnlPercent: number | null
  hitTarget: string | null
  source: string
  strength: number
  confidence: number
  validPeriod: string
  createdAt: string
  closedAt: string | null
  durationHours: number | null
}

interface SignalStats {
  active: number
  completed: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  avgPnl: number
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

export function AlphaEnginePageContent() {
  return <AlphaEnginePageInner />
}

export default function AlphaEnginePage() {
  return <NexusLayout><AlphaEnginePageInner /></NexusLayout>
}

function AlphaEnginePageInner() {
  const [signals, setSignals] = useState<AlphaSignal[]>([])
  const [history, setHistory] = useState<SignalHistory[]>([])
  const [signalStats, setSignalStats] = useState<SignalStats>({ active: 0, completed: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0 })
  const [predictions, setPredictions] = useState<{ open: Prediction[]; closed: Prediction[]; accuracy: Accuracy }>({ open: [], closed: [], accuracy: { total: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0 } })
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [tab, setTab] = useState<'signals' | 'history' | 'predictions' | 'accuracy'>('signals')
  const [marketScore, setMarketScore] = useState<{compositeScore: number; direction: string; confidence: number; topSignals: string[]} | null>(null)
  const fetchData = useCallback(async () => {
    try {
      const [alphaRes, predRes, historyRes, scoreRes] = await Promise.allSettled([
        fetch('/api/v1/alpha-engine').then(r => r.json()),
        fetch('/api/v1/paper-trading').then(r => r.json()),
        fetch('/api/v1/signals/history?limit=50').then(r => r.json()),
        fetch('/api/v1/market-score?symbol=BTC').then(r => r.json()),
      ])

      if (alphaRes.status === 'fulfilled' && alphaRes.value?.data) {
        setSignals(alphaRes.value.data.signals ?? alphaRes.value.data ?? [])
      }
      if (predRes.status === 'fulfilled' && predRes.value?.data) {
        setPredictions(predRes.value.data)
      }
      if (historyRes.status === 'fulfilled' && historyRes.value?.data) {
        setHistory(historyRes.value.data.signals ?? [])
        setSignalStats(historyRes.value.data.stats ?? { active: 0, completed: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0 })
      }
      if (scoreRes.status === 'fulfilled' && scoreRes.value?.data?.score) {
        setMarketScore(scoreRes.value.data.score)
      }
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

  const acc = predictions.accuracy

  return (
    <>
      <FinancialDisclaimer variant="modal" />
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
          <KPI label="Active Signals" value={String(signalStats.active)} />
          <KPI label="Completed" value={String(signalStats.completed)} />
          <KPI label="Win Rate" value={`${signalStats.winRate.toFixed(1)}%`} color={signalStats.winRate > 50 ? 'text-data-bull' : signalStats.winRate > 0 ? 'text-data-bear' : 'text-text-muted'} />
          <KPI label="Total PnL" value={`${signalStats.totalPnl > 0 ? '+' : ''}${signalStats.totalPnl.toFixed(2)}%`} color={signalStats.totalPnl >= 0 ? 'text-data-bull' : 'text-data-bear'} />
          <KPI label="W / L" value={`${signalStats.wins} / ${signalStats.losses}`} />
          <KPI label="Avg PnL" value={`${signalStats.avgPnl > 0 ? '+' : ''}${signalStats.avgPnl.toFixed(2)}%`} color={signalStats.avgPnl >= 0 ? 'text-data-bull' : 'text-data-bear'} />
        </div>

        {/* Market-Moving Score */}
        {marketScore && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3 flex items-center gap-6">
            <div>
              <span className="text-[10px] font-mono text-text-muted">MARKET SCORE</span>
              <span className={`ml-2 text-[20px] font-mono font-bold ${
                marketScore.compositeScore >= 60 ? 'text-data-bull' : marketScore.compositeScore <= 40 ? 'text-data-bear' : 'text-data-orange'
              }`}>
                {marketScore.compositeScore}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-text-muted">DIRECTION</span>
              <span className={`ml-2 text-[12px] font-mono font-bold ${
                marketScore.direction === 'bullish' ? 'text-data-bull' : marketScore.direction === 'bearish' ? 'text-data-bear' : 'text-text-muted'
              }`}>
                {marketScore.direction.toUpperCase()}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-text-muted">CONF</span>
              <span className="ml-2 text-[12px] font-mono text-text-primary">{(marketScore.confidence * 100).toFixed(0)}%</span>
            </div>
            <div className="flex-1">
              <span className="text-[10px] font-mono text-text-muted">TOP SIGNALS</span>
              <span className="ml-2 text-[10px] font-mono text-text-secondary">
                {marketScore.topSignals.slice(0, 2).join(' · ')}
              </span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {(['signals', 'history', 'predictions', 'accuracy'] as const).map(t => (
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
              {signals.map((s, i) => {
                const isExpired = s.expiresAt < Date.now()
                const periodLabel: Record<ValidPeriod, string> = { '4h': '4H', '24h': '24H', '7d': '7D' }

                return (
                  <div key={i} className={`flex flex-col gap-2 py-3 px-3 border-b border-bg-border/50 hover:bg-bg-raised transition-colors ${isExpired ? 'opacity-50' : ''}`}>
                    {/* Header row */}
                    <div className="flex items-start gap-3">
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
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                            isExpired ? 'bg-data-bear/20 text-data-bear' : 'bg-data-bull/20 text-data-bull'
                          }`}>
                            {isExpired ? 'EXPIRED' : periodLabel[s.validPeriod]}
                          </span>
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
                        {s.entry && s.tp1 && s.sl && (
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-text-muted">R:R</span>
                            <span className={`text-[12px] font-mono font-bold ${
                              ((s.tp1 - s.entry) / (s.entry - s.sl)) > 2 ? 'text-data-bull' :
                              ((s.tp1 - s.entry) / (s.entry - s.sl)) > 1 ? 'text-data-orange' :
                              'text-data-bear'
                            }`}>
                              {((s.tp1 - s.entry) / (s.entry - s.sl)).toFixed(1)}:1
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Trading levels row */}
                    {s.entry && (
                      <div className="flex items-center gap-3 ml-8 text-[10px] font-mono">
                        <span className="text-text-muted">ENTRY</span>
                        <span className="text-text-primary font-bold">${s.entry.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        {s.tp1 && (
                          <>
                            <span className="text-data-bull">TP1</span>
                            <span className="text-data-bull">${s.tp1.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </>
                        )}
                        {s.tp2 && (
                          <>
                            <span className="text-data-bull">TP2</span>
                            <span className="text-data-bull">${s.tp2.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </>
                        )}
                        {s.tp3 && (
                          <>
                            <span className="text-data-bull">TP3</span>
                            <span className="text-data-bull">${s.tp3.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </>
                        )}
                        {s.sl && (
                          <>
                            <span className="text-data-bear">SL</span>
                            <span className="text-data-bear">${s.sl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </>
                        )}
                        <span className="text-text-muted ml-auto">{new Date(s.timestamp).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {signals.length === 0 && (
                <div className="p-8 text-center text-text-muted text-[12px] font-mono">Alpha engine is warming up...</div>
              )}
            </div>
          </Panel>
        )}

        {tab === 'history' && (
          <Panel title="Signal History" subtitle={`${history.length} signals with PnL tracking`} liveStatus={status} onRefresh={fetchData}>
            <div className="space-y-1 p-2">
              {history.map((s, i) => {
                const isWin = s.outcome === 'win'
                const isLoss = s.outcome === 'loss'
                const isActive = s.status === 'active'

                return (
                  <div key={i} className="flex items-center gap-4 py-2 px-3 border-b border-bg-border/50 hover:bg-bg-raised transition-colors">
                    {/* Status indicator */}
                    <span className={`text-[16px] ${isActive ? 'text-teal-vivid' : isWin ? 'text-data-bull' : isLoss ? 'text-data-bear' : 'text-text-muted'}`}>
                      {isActive ? '🔵' : isWin ? '✅' : isLoss ? '❌' : '⏰'}
                    </span>

                    {/* Symbol & Direction */}
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <span className="text-[12px] font-mono font-bold text-teal-vivid">{s.symbol}</span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        s.direction === 'bullish' ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                      }`}>
                        {s.direction.toUpperCase()}
                      </span>
                    </div>

                    {/* Trading Levels */}
                    <div className="flex items-center gap-3 text-[10px] font-mono">
                      <span className="text-text-muted">ENTRY</span>
                      <span className="text-text-primary">${s.entry.toLocaleString()}</span>
                      {s.tp1 && (
                        <>
                          <span className="text-data-bull">TP1</span>
                          <span className="text-data-bull">${s.tp1.toLocaleString()}</span>
                        </>
                      )}
                      {s.sl && (
                        <>
                          <span className="text-data-bear">SL</span>
                          <span className="text-data-bear">${s.sl.toLocaleString()}</span>
                        </>
                      )}
                    </div>

                    {/* Outcome & PnL */}
                    <div className="flex items-center gap-3 ml-auto">
                      {s.hitTarget && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          s.hitTarget.startsWith('tp') ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                        }`}>
                          {s.hitTarget.toUpperCase()}
                        </span>
                      )}
                      {s.pnlPercent !== null && (
                        <span className={`text-[12px] font-mono font-bold ${s.pnlPercent >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {s.pnlPercent >= 0 ? '+' : ''}{s.pnlPercent.toFixed(2)}%
                        </span>
                      )}
                      {s.durationHours !== null && (
                        <span className="text-[10px] font-mono text-text-muted">
                          {s.durationHours < 1 ? '<1h' : `${s.durationHours.toFixed(0)}h`}
                        </span>
                      )}
                      <span className="text-[9px] font-mono text-text-muted">{s.source}</span>
                    </div>
                  </div>
                )
              })}
              {history.length === 0 && (
                <div className="p-8 text-center text-text-muted text-[12px] font-mono">
                  No signal history yet. Signals will appear here after they expire or hit TP/SL.
                </div>
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
    </>
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