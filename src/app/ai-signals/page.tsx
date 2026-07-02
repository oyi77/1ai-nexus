"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

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
  // Trading levels
  entry: number | null
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  validPeriod: ValidPeriod
  expiresAt: number
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
  const [macro, setMacro] = useState<MacroData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    const compute = async () => {
      try {
        // Fetch real market data
        const symbols = WATCHLIST.map(w => w.symbol).join(',')
        const quoteRes = await fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`)
        const quoteData = await quoteRes.json()

        // Fetch real macro data
        const macroRes = await fetch('/api/v1/macro')
        const macroData = await macroRes.json()

        // Compute signals from real data
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

          // Compute signal strength from real indicators
          const signals: string[] = []
          let bullish = 0
          let bearish = 0

          // Trend: price vs SMA50/200
          if (price > sma50) { bullish++; signals.push(`Price above SMA50 (${sma50.toFixed(2)})`) }
          else { bearish++; signals.push(`Price below SMA50 (${sma50.toFixed(2)})`) }

          if (price > sma200) { bullish++; signals.push(`Price above SMA200 (${sma200.toFixed(2)})`) }
          else { bearish++; signals.push(`Price below SMA200 (${sma200.toFixed(2)})`) }

          // Golden/Death cross
          if (sma50 > sma200) { bullish++; signals.push('Golden cross: SMA50 > SMA200') }
          else { bearish++; signals.push('Death cross: SMA50 < SMA200') }

          // 52-week position
          const position52w = high52w > low52w ? (price - low52w) / (high52w - low52w) : 0.5
          if (position52w > 0.8) { bearish++; signals.push(`Near 52-week high (${(position52w * 100).toFixed(0)}%)`) }
          else if (position52w < 0.2) { bullish++; signals.push(`Near 52-week low (${(position52w * 100).toFixed(0)}%)`) }

          // Momentum
          if (change > 2) { bullish++; signals.push(`Strong momentum: +${change.toFixed(2)}%`) }
          else if (change < -2) { bearish++; signals.push(`Weak momentum: ${change.toFixed(2)}%`) }

          // Volume (high volume = conviction)
          if (volume > 10000000) { signals.push(`High volume: ${(volume / 1e6).toFixed(0)}M`) }

          const total = bullish + bearish
          const strength = total > 0 ? Math.round((Math.max(bullish, bearish) / total) * 100) : 50
          const direction = bullish >= bearish ? 'LONG' : 'SHORT'
          const confidence = Math.min(95, Math.round(50 + (total * 5)))

          // Calculate trading levels using 52-week range as volatility proxy
          const range52w = high52w - low52w
          const atrProxy = range52w * 0.05 // Use 5% of 52-week range as ATR proxy
          const directionTyped = direction as 'LONG' | 'SHORT'

          const entry = price
          const tp1 = directionTyped === 'LONG' ? entry + atrProxy * 0.5 : entry - atrProxy * 0.5
          const tp2 = directionTyped === 'LONG' ? entry + atrProxy * 1.0 : entry - atrProxy * 1.0
          const tp3 = directionTyped === 'LONG' ? entry + atrProxy * 1.5 : entry - atrProxy * 1.5
          const sl = directionTyped === 'LONG' ? entry - atrProxy * 0.75 : entry + atrProxy * 0.75

          // Determine valid period based on strength
          const validPeriod: ValidPeriod = strength >= 80 ? '7d' : strength >= 60 ? '24h' : '4h'
          const periodMs: Record<ValidPeriod, number> = { '4h': 4 * 3600000, '24h': 86400000, '7d': 604800000 }
          const expiresAt = Date.now() + periodMs[validPeriod]

          computed.push({
            id: q.symbol,
            symbol: q.symbol,
            name: meta.name,
            assetClass: meta.class,
            direction: directionTyped,
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

        // Sort by strength
        computed.sort((a, b) => b.strength - a.strength)

        // Process macro data
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

        setSignals(computed)
        setMacro(macroIndicators)
        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    compute()
    // Refresh every 5 minutes
    const interval = setInterval(compute, 300000)
    return () => clearInterval(interval)
  }, [])

  const filtered = filter === 'All' ? signals : signals.filter(s => s.assetClass === filter.toLowerCase())
  const longCount = signals.filter(s => s.direction === 'LONG').length
  const shortCount = signals.filter(s => s.direction === 'SHORT').length

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
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

        {/* Signal Summary */}
        <div className="grid grid-cols-4 gap-4">
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
            <p className="text-[10px] text-text-muted font-mono">DATA SOURCE</p>
            <p className="text-sm font-bold font-mono text-accent-cyan">Yahoo Finance</p>
          </div>
        </div>

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
                    <span className={`text-sm font-mono font-bold ${
                      signal.direction === 'LONG' ? 'text-data-bull' : 'text-data-bear'
                    }`}>
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
                      <p className="text-sm font-mono font-bold text-text-primary">${signal.price.toFixed(2)}</p>
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
                      <span className="text-text-primary font-bold">${signal.entry.toFixed(2)}</span>
                      {signal.tp1 && (
                        <>
                          <span className="text-data-bull">TP1</span>
                          <span className="text-data-bull">${signal.tp1.toFixed(2)}</span>
                        </>
                      )}
                      {signal.tp2 && (
                        <>
                          <span className="text-data-bull">TP2</span>
                          <span className="text-data-bull">${signal.tp2.toFixed(2)}</span>
                        </>
                      )}
                      {signal.tp3 && (
                        <>
                          <span className="text-data-bull">TP3</span>
                          <span className="text-data-bull">${signal.tp3.toFixed(2)}</span>
                        </>
                      )}
                      {signal.sl && (
                        <>
                          <span className="text-data-bear">SL</span>
                          <span className="text-data-bear">${signal.sl.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">METHODOLOGY</h2>
          <p className="text-xs text-text-dim">
            Signals computed from REAL market data via Yahoo Finance API.
            Factors: price vs SMA50/200, golden/death cross, 52-week position, momentum, volume.
            Macro context from FRED API (22 series).
            Strength = ratio of bullish vs bearish factors.
            Confidence = number of factors analyzed.
            All data is live — no hardcoded values.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
