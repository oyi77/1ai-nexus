"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import { FinancialDisclaimer } from '@/components/FinancialDisclaimer'
import { formatPriceUSD } from '@/lib/format'

type ValidPeriod = '4h' | '24h' | '7d'

interface ComputedSignal {
  id: string
  symbol: string
  name: string
  assetClass: string
  direction: 'LONG' | 'SHORT'
  strength: number
  confidence: number
  price: number
  change: number
  signals: string[]
  timestamp: string
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

interface MacroData {
  indicator: string
  value: string
  date: string
}

const WATCHLIST = [
  { symbol: 'AAPL', name: 'Apple', class: 'equity' },
  { symbol: 'MSFT', name: 'Microsoft', class: 'equity' },
  { symbol: 'NVDA', name: 'NVIDIA', class: 'equity' },
  { symbol: 'TSLA', name: 'Tesla', class: 'equity' },
  { symbol: 'BTC-USD', name: 'Bitcoin', class: 'crypto' },
  { symbol: 'ETH-USD', name: 'Ethereum', class: 'crypto' },
  { symbol: 'GC=F', name: 'Gold', class: 'commodity' },
  { symbol: 'CL=F', name: 'Crude Oil', class: 'commodity' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', class: 'forex' },
  { symbol: 'JPY=X', name: 'USD/JPY', class: 'forex' },
]

export default function AiSignalsPage() {
  const [signals, setSignals] = useState<ComputedSignal[]>([])
  const [history, setHistory] = useState<SignalHistory[]>([])
  const [signalStats, setSignalStats] = useState({ active: 0, completed: 0, wins: 0, losses: 0, expired: 0, winRate: 0, totalPnl: 0, avgWin: 0, avgLoss: 0 })
  const [macro, setMacro] = useState<MacroData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')
  const [tab, setTab] = useState<'signals' | 'history'>('signals')

  useEffect(() => {
    const compute = async () => {
      try {
        const symbols = WATCHLIST.map(w => w.symbol).join(',')
        const [quoteRes, macroRes, historyRes] = await Promise.allSettled([
          fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`),
          fetch('/api/v1/macro'),
          fetch('/api/v1/signals/history?limit=50'),
        ])

        // Process quotes
        if (quoteRes.status === 'fulfilled') {
          const quoteData = await quoteRes.value.json()
          const computed: ComputedSignal[] = []

          for (const q of quoteData.data ?? []) {
            const meta = WATCHLIST.find(w => w.symbol === q.symbol)
            if (!meta) continue

            const price = q.regularMarketPrice ?? 0
            const change = q.regularMarketChangePercent ?? 0
            const volume = q.regularMarketVolume ?? 0
            const high52w = q.fiftyTwoWeekHigh ?? price
            const low52w = q.fiftyTwoWeekLow ?? price
            const sma50 = q.fiftyDayAverage ?? price
            const sma200 = q.twoHundredDayAverage ?? price

            const signals: string[] = []
            let bullish = 0
            let bearish = 0

            if (price > sma50) { bullish++; signals.push(`Price above SMA50 (${sma50.toFixed(2)})`) }
            else { bearish++; signals.push(`Price below SMA50 (${sma50.toFixed(2)})`) }

            if (price > sma200) { bullish++; signals.push(`Price above SMA200 (${sma200.toFixed(2)})`) }
            else { bearish++; signals.push(`Price below SMA200 (${sma200.toFixed(2)})`) }

            if (sma50 > sma200) { bullish++; signals.push('Golden cross: SMA50 > SMA200') }
            else { bearish++; signals.push('Death cross: SMA50 < SMA200') }

            const position52w = high52w > low52w ? (price - low52w) / (high52w - low52w) : 0.5
            if (position52w > 0.8) { bearish++; signals.push(`Near 52-week high (${(position52w * 100).toFixed(0)}%)`) }
            else if (position52w < 0.2) { bullish++; signals.push(`Near 52-week low (${(position52w * 100).toFixed(0)}%)`) }

            if (change > 2) { bullish++; signals.push(`Strong momentum: +${change.toFixed(2)}%`) }
            else if (change < -2) { bearish++; signals.push(`Weak momentum: ${change.toFixed(2)}%`) }

            if (volume > 10000000) { signals.push(`High volume: ${(volume / 1e6).toFixed(0)}M`) }

            const total = bullish + bearish
            const strength = total > 0 ? Math.round((Math.max(bullish, bearish) / total) * 100) : 50
            const direction = bullish >= bearish ? 'LONG' : 'SHORT'
            const confidence = Math.min(95, Math.round(50 + (total * 5)))

            const range52w = high52w - low52w
            const atrProxy = range52w * 0.05
            const entry = price
            const tp1 = direction === 'LONG' ? entry + atrProxy * 0.5 : entry - atrProxy * 0.5
            const tp2 = direction === 'LONG' ? entry + atrProxy * 1.0 : entry - atrProxy * 1.0
            const tp3 = direction === 'LONG' ? entry + atrProxy * 1.5 : entry - atrProxy * 1.5
            const sl = direction === 'LONG' ? entry - atrProxy * 0.75 : entry + atrProxy * 0.75

            const validPeriod: ValidPeriod = strength >= 80 ? '7d' : strength >= 60 ? '24h' : '4h'
            const periodMs: Record<ValidPeriod, number> = { '4h': 4 * 3600000, '24h': 86400000, '7d': 604800000 }
            const expiresAt = Date.now() + periodMs[validPeriod]

            computed.push({
              id: q.symbol,
              symbol: q.symbol,
              name: meta.name,
              assetClass: meta.class,
              direction,
              strength,
              confidence,
              price,
              change,
              signals,
              timestamp: new Date().toISOString(),
              entry,
              tp1,
              tp2,
              tp3,
              sl,
              validPeriod,
              expiresAt,
            })
          }

          computed.sort((a, b) => b.strength - a.strength)
          setSignals(computed)
        }

        // Process macro
        if (macroRes.status === 'fulfilled') {
          const macroData = await macroRes.value.json()
          const macroIndicators: MacroData[] = []
          if (macroData.data?.indicators) {
            for (const ind of macroData.data.indicators.slice(0, 8)) {
              macroIndicators.push({
                indicator: ind.name ?? ind.id,
                value: `${ind.latestValue?.toLocaleString() ?? '—'} ${ind.unit ?? ''}`,
                date: ind.latestDate ?? '',
              })
            }
          }
          setMacro(macroIndicators)
        }

        // Process history
        if (historyRes.status === 'fulfilled') {
          const historyData = await historyRes.value.json()
          setHistory(historyData.data?.signals ?? [])
          const s = historyData.data?.stats
          setSignalStats({
            active:    s?.pending   ?? 0,
            completed: (s?.wins ?? 0) + (s?.losses ?? 0),
            wins:      s?.wins      ?? 0,
            losses:    s?.losses    ?? 0,
            expired:   s?.expired   ?? 0,
            winRate:   s?.winRate   ?? 0,
            totalPnl:  s?.totalPnl  ?? 0,
            avgWin:    s?.avgWin    ?? 0,
            avgLoss:   s?.avgLoss   ?? 0,
          })
        }

        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    compute()
    const interval = setInterval(compute, 300000)
    return () => clearInterval(interval)
  }, [])

  const filtered = filter === 'All' ? signals : signals.filter(s => s.assetClass === filter.toLowerCase())
  const longCount = signals.filter(s => s.direction === 'LONG').length
  const shortCount = signals.filter(s => s.direction === 'SHORT').length
  
  // History stats — use global signalStats (same source as signals tab) so numbers are consistent
  const historyTotal = signalStats.active + signalStats.completed
  const historyWins = signalStats.wins
  const historyLosses = signalStats.losses
  const historyActive = signalStats.active
  const historyWinRate = signalStats.winRate
  const historyAvgPnl = signalStats.avgWin

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
      <FinancialDisclaimer variant="banner" />
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">AI TRADING SIGNALS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {signals.length} signals computed from real market data · Yahoo Finance + FRED
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
        </div>

        {error && (
          <div className="text-data-bear text-[11px] font-mono p-4 bg-bg-panel border border-border-dim rounded">
            Error: {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {(['signals', 'history'] as const).map(t => (
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
          <>
        {/* Signal Summary */}
        <div className="grid grid-cols-6 gap-4">
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">SIGNALS</p>
            <p className="text-xl font-bold font-mono text-text-primary">{signals.length}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">LONG</p>
            <p className="text-xl font-bold font-mono text-data-bull">{longCount}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">SHORT</p>
            <p className="text-xl font-bold font-mono text-data-bear">{shortCount}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">WIN RATE</p>
            <p className="text-xl font-bold font-mono text-text-primary">{signalStats.winRate.toFixed(1)}%</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">COMPLETED</p>
            <p className="text-xl font-bold font-mono text-text-primary">{signalStats.completed}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">TOTAL PNL</p>
            <p className={`text-xl font-bold font-mono ${signalStats.totalPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
              {signalStats.totalPnl >= 0 ? '+' : ''}{signalStats.totalPnl.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Macro Context */}
        {macro.length > 0 && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h2 className="text-xs font-mono text-accent-cyan mb-3">MACRO CONTEXT (FRED)</h2>
            <div className="grid grid-cols-4 gap-2">
              {macro.map(m => (
                <div key={m.indicator} className="bg-bg-elevated p-2 rounded">
                  <p className="text-[10px] text-text-muted font-mono">{m.indicator}</p>
                  <p className="text-sm font-bold font-mono text-text-primary">{m.value}</p>
                  <p className="text-[9px] text-text-dim">{m.date}</p>
                </div>
              ))}
            </div>
          </div>
        )}
          </>
        )}

        {tab === 'signals' && (
          <>
            {/* Filter */}
            <div className="flex flex-wrap gap-2">
              {['All', 'Equity', 'Crypto', 'Forex', 'Commodity'].map(cls => (
                <button key={cls} onClick={() => setFilter(cls)}
                  className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                    filter === cls
                      ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                      : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
                  }`}>
                  {cls}
                </button>
              ))}
            </div>

            {/* Signals */}
            {loading ? (
              <div className="text-text-dim text-xs p-8 text-center">Computing signals from real market data...</div>
            ) : filtered.length === 0 ? (
              <div className="text-text-dim text-xs p-8 text-center">No signals computed</div>
            ) : (
              <div className="space-y-3">
                {filtered.map(signal => (
                  <div key={signal.id} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-mono font-bold ${signal.direction === 'LONG' ? 'text-data-bull' : 'text-data-bear'}`}>
                          {signal.direction}
                        </span>
                        <span className="text-sm font-mono font-bold text-accent-cyan">{signal.symbol}</span>
                        <span className="text-xs text-text-dim">{signal.name}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-elevated text-text-muted">
                          {signal.assetClass.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-[10px] text-text-muted font-mono">PRICE</p>
                          <p className="text-sm font-mono font-bold text-text-primary">{formatPriceUSD(signal.price)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-text-muted font-mono">CHG</p>
                          <p className={`text-sm font-mono font-bold ${signal.change >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                            {signal.change >= 0 ? '+' : ''}{signal.change.toFixed(2)}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-text-muted font-mono">STRENGTH</p>
                          <p className="text-sm font-mono font-bold text-accent-cyan">{signal.strength}%</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-text-muted font-mono">CONF</p>
                          <p className="text-sm font-mono font-bold text-text-primary">{signal.confidence}%</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-border-dim">
                      <p className="text-[10px] text-accent-cyan font-mono mb-1">SIGNAL FACTORS ({signal.signals.length})</p>
                      <ul className="space-y-0.5">
                        {signal.signals.map((s, i) => (
                          <li key={i} className="text-[10px] text-text-dim flex items-start gap-2">
                            <span className="text-accent-cyan">•</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Trading Levels */}
                    {signal.entry && (
                      <div className="mt-2 pt-2 border-t border-border-dim">
                        <div className="flex items-center gap-4 text-[11px] font-mono">
                          <span className="text-text-muted">VALID</span>
                          <span className={`px-1.5 py-0.5 rounded ${
                            signal.expiresAt < Date.now() ? 'bg-data-bear/20 text-data-bear' : 'bg-data-bull/20 text-data-bull'
                          }`}>
                            {signal.expiresAt < Date.now() ? 'EXPIRED' : signal.validPeriod}
                          </span>
                          <span className="text-text-muted">ENTRY</span>
                          <span className="text-text-primary font-bold">{formatPriceUSD(signal.entry)}</span>
                          {signal.tp1 && (
                            <>
                              <span className="text-data-bull">TP1</span>
                              <span className="text-data-bull">{formatPriceUSD(signal.tp1)}</span>
                            </>
                          )}
                          {signal.tp2 && (
                            <>
                              <span className="text-data-bull">TP2</span>
                              <span className="text-data-bull">{formatPriceUSD(signal.tp2)}</span>
                            </>
                          )}
                          {signal.tp3 && (
                            <>
                              <span className="text-data-bull">TP3</span>
                              <span className="text-data-bull">{formatPriceUSD(signal.tp3)}</span>
                            </>
                          )}
                          {signal.sl && (
                            <>
                              <span className="text-data-bear">SL</span>
                              <span className="text-data-bear">{formatPriceUSD(signal.sl)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {/* History Summary */}
            <div className="grid grid-cols-6 gap-4">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">TOTAL</p>
                <p className="text-xl font-bold font-mono text-text-primary">{historyTotal}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">WINS</p>
                <p className="text-xl font-bold font-mono text-data-bull">{historyWins}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">LOSSES</p>
                <p className="text-xl font-bold font-mono text-data-bear">{historyLosses}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">ACTIVE</p>
                <p className="text-xl font-bold font-mono text-teal-vivid">{historyActive}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">WIN RATE</p>
                <p className="text-xl font-bold font-mono text-text-primary">{historyWinRate.toFixed(1)}%</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">AVG PNL</p>
                <p className={`text-xl font-bold font-mono ${historyAvgPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                  {historyAvgPnl >= 0 ? '+' : ''}{historyAvgPnl.toFixed(2)}%
                </p>
              </div>
            </div>

            <div className="bg-bg-panel border border-border-dim rounded-lg">
              <div className="p-4 border-b border-border-dim">
                <h2 className="text-sm font-mono text-accent-cyan">Signal History</h2>
                <p className="text-[10px] text-text-muted font-mono mt-1">{historyTotal} signals tracked</p>
              </div>
            <div className="divide-y divide-border-dim">
              {history.length === 0 ? (
                <div className="p-8 text-center text-text-muted text-[12px] font-mono">
                  No signal history yet. Signals will appear after 24h+ when they expire or hit TP/SL.
                </div>
              ) : (
                history.map((s, i) => {
                  const isWin = s.outcome === 'win'
                  const isLoss = s.outcome === 'loss'
                  const isActive = s.status === 'active'

                  return (
                    <div key={i} className="flex items-center gap-4 px-4 py-3 hover:bg-bg-raised transition-colors">
                      <span className={`text-[16px] ${isActive ? 'text-teal-vivid' : isWin ? 'text-data-bull' : isLoss ? 'text-data-bear' : 'text-text-muted'}`}>
                        {isActive ? '🔵' : isWin ? '✅' : isLoss ? '❌' : '⏰'}
                      </span>

                      <div className="flex items-center gap-2 min-w-[100px]">
                        <span className="text-[12px] font-mono font-bold text-teal-vivid">{s.symbol}</span>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          s.direction === 'bullish' ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                        }`}>
                          {s.direction.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[10px] font-mono">
                        <span className="text-text-muted">ENTRY</span>
                        <span className="text-text-primary">{formatPriceUSD(s.entry)}</span>
                        {s.tp1 && (
                          <>
                            <span className="text-data-bull">TP1</span>
                            <span className="text-data-bull">{formatPriceUSD(s.tp1)}</span>
                          </>
                        )}
                        {s.sl && (
                          <>
                            <span className="text-data-bear">SL</span>
                            <span className="text-data-bear">{formatPriceUSD(s.sl)}</span>
                          </>
                        )}
                      </div>

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
                })
              )}
            </div>
          </div>
          </>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">DATA SOURCES</h2>
          <p className="text-[10px] text-text-dim font-mono">
            Yahoo Finance (equities, forex, commodities) · FRED (macro indicators) · Binance (crypto)
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
