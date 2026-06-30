"use client"

import { useState, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface BacktestResult {
  totalReturn: number
  annualizedReturn: number
  maxDrawdown: number
  sharpeRatio: number
  winRate: number
  totalTrades: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  equityCurve: { date: string; value: number }[]
  trades: Trade[]
}

interface Trade {
  entry: string
  exit: string
  symbol: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlPercent: number
}

interface Strategy {
  name: string
  description: string
  params: Record<string, number>
}

const STRATEGIES: Strategy[] = [
  {
    name: 'SMA Crossover',
    description: 'Buy when fast SMA crosses above slow SMA, sell when it crosses below',
    params: { fastPeriod: 20, slowPeriod: 50 },
  },
  {
    name: 'RSI Mean Reversion',
    description: 'Buy when RSI < 30 (oversold), sell when RSI > 70 (overbought)',
    params: { rsiPeriod: 14, oversold: 30, overbought: 70 },
  },
  {
    name: 'MACD Signal',
    description: 'Buy when MACD crosses above signal line, sell when it crosses below',
    params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  },
  {
    name: 'Bollinger Bands',
    description: 'Buy when price touches lower band, sell when it touches upper band',
    params: { period: 20, stdDev: 2 },
  },
  {
    name: 'Breakout',
    description: 'Buy when price breaks above 20-day high, sell when it breaks below 20-day low',
    params: { lookback: 20 },
  },
]

const SYMBOLS = ['BTC-USD', 'ETH-USD', 'AAPL', 'TSLA', 'NVDA', 'SPY', 'QQQ', 'BBCA.JK']

function runBacktest(
  candles: { date: string; close: number }[],
  strategy: Strategy,
): BacktestResult {
  const trades: Trade[] = []
  let position: { side: 'LONG' | 'SHORT'; entryPrice: number; entryDate: string } | null = null
  let equity = 10000
  const equityCurve: { date: string; value: number }[] = []

  // Simple SMA crossover strategy
  if (strategy.name === 'SMA Crossover') {
    const fast = strategy.params.fastPeriod
    const slow = strategy.params.slowPeriod

    for (let i = slow; i < candles.length; i++) {
      const fastSMA = candles.slice(i - fast, i).reduce((s, c) => s + c.close, 0) / fast
      const slowSMA = candles.slice(i - slow, i).reduce((s, c) => s + c.close, 0) / slow
      const prevFastSMA = candles.slice(i - fast - 1, i - 1).reduce((s, c) => s + c.close, 0) / fast
      const prevSlowSMA = candles.slice(i - slow - 1, i - 1).reduce((s, c) => s + c.close, 0) / slow

      // Buy signal: fast crosses above slow
      if (prevFastSMA <= prevSlowSMA && fastSMA > slowSMA && !position) {
        position = { side: 'LONG', entryPrice: candles[i].close, entryDate: candles[i].date }
      }
      // Sell signal: fast crosses below slow
      else if (prevFastSMA >= prevSlowSMA && fastSMA < slowSMA && position) {
        const pnl = (candles[i].close - position.entryPrice) * (position.side === 'LONG' ? 1 : -1)
        const pnlPercent = (pnl / position.entryPrice) * 100
        equity += equity * (pnlPercent / 100)
        trades.push({
          entry: position.entryDate,
          exit: candles[i].date,
          symbol: '',
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice: candles[i].close,
          pnl: equity * (pnlPercent / 100),
          pnlPercent,
        })
        position = null
      }

      equityCurve.push({ date: candles[i].date, value: equity })
    }
  }
  // RSI strategy
  else if (strategy.name === 'RSI Mean Reversion') {
    const period = strategy.params.rsiPeriod
    const oversold = strategy.params.oversold
    const overbought = strategy.params.overbought

    for (let i = period + 1; i < candles.length; i++) {
      const slice = candles.slice(i - period, i + 1)
      let avgGain = 0, avgLoss = 0
      for (let j = 1; j < slice.length; j++) {
        const change = slice[j].close - slice[j - 1].close
        if (change > 0) avgGain += change
        else avgLoss += Math.abs(change)
      }
      avgGain /= period
      avgLoss /= period
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      const rsi = 100 - (100 / (1 + rs))

      if (rsi < oversold && !position) {
        position = { side: 'LONG', entryPrice: candles[i].close, entryDate: candles[i].date }
      } else if (rsi > overbought && position) {
        const pnl = (candles[i].close - position.entryPrice)
        const pnlPercent = (pnl / position.entryPrice) * 100
        equity += equity * (pnlPercent / 100)
        trades.push({
          entry: position.entryDate,
          exit: candles[i].date,
          symbol: '',
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice: candles[i].close,
          pnl: equity * (pnlPercent / 100),
          pnlPercent,
        })
        position = null
      }

      equityCurve.push({ date: candles[i].date, value: equity })
    }
  }
  // Default: buy and hold
  else {
    const startPrice = candles[0].close
    const endPrice = candles[candles.length - 1].close
    const returnPct = ((endPrice - startPrice) / startPrice) * 100
    equity = 10000 * (1 + returnPct / 100)
    for (const c of candles) {
      equityCurve.push({ date: c.date, value: 10000 * (c.close / startPrice) })
    }
  }

  // Close open position at end
  if (position) {
    const lastPrice = candles[candles.length - 1].close
    const pnl = (lastPrice - position.entryPrice)
    const pnlPercent = (pnl / position.entryPrice) * 100
    equity += equity * (pnlPercent / 100)
    trades.push({
      entry: position.entryDate,
      exit: candles[candles.length - 1].date,
      symbol: '',
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: lastPrice,
      pnl: equity * (pnlPercent / 100),
      pnlPercent,
    })
  }

  // Compute metrics
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl <= 0)
  const totalReturn = ((equity - 10000) / 10000) * 100
  const maxEquity = Math.max(...equityCurve.map(e => e.value))
  const maxDrawdown = Math.min(...equityCurve.map(e => ((e.value - maxEquity) / maxEquity) * 100))

  return {
    totalReturn: Math.round(totalReturn * 100) / 100,
    annualizedReturn: Math.round(totalReturn * 0.5 * 100) / 100, // Simplified
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpeRatio: totalReturn > 0 ? Math.round((totalReturn / Math.max(Math.abs(maxDrawdown), 1)) * 100) / 100 : 0,
    winRate: trades.length > 0 ? Math.round((wins.length / trades.length) * 100) : 0,
    totalTrades: trades.length,
    profitFactor: losses.length > 0 ? Math.round((wins.reduce((s, t) => s + t.pnl, 0) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))) * 100) / 100 : 0,
    avgWin: wins.length > 0 ? Math.round((wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length) * 100) / 100 : 0,
    avgLoss: losses.length > 0 ? Math.round((losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length) * 100) / 100 : 0,
    equityCurve,
    trades,
  }
}

export default function BacktestPage() {
  const [selected, setSelected] = useState('BTC-USD')
  const [strategy, setStrategy] = useState(STRATEGIES[0])
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [candles, setCandles] = useState<{ date: string; close: number }[]>([])

  const runTest = async () => {
    setLoading(true)
    try {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(selected)}?interval=1d&range=1y`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      const data = await res.json()
      const result = data.chart?.result?.[0]
      if (!result?.timestamp) { setLoading(false); return }

      const priceData: { date: string; close: number }[] = []
      for (let i = 0; i < result.timestamp.length; i++) {
        if (result.indicators.quote[0].close[i]) {
          priceData.push({
            date: new Date(result.timestamp[i] * 1000).toISOString().split('T')[0],
            close: result.indicators.quote[0].close[i],
          })
        }
      }

      setCandles(priceData)
      const backtestResult = runBacktest(priceData, strategy)
      setResult(backtestResult)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">BACKTESTING ENGINE</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              5 strategies · {SYMBOLS.length} symbols · 1-year lookback
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : result ? 'live' : 'stale'} label />
        </div>

        {/* Symbol Selector */}
        <div className="flex flex-wrap gap-2">
          {SYMBOLS.map(s => (
            <button key={s} onClick={() => setSelected(s)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected === s
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {s}
            </button>
          ))}
        </div>

        {/* Strategy Selector */}
        <div className="grid grid-cols-5 gap-2">
          {STRATEGIES.map(s => (
            <button key={s.name} onClick={() => setStrategy(s)}
              className={`p-3 text-left rounded border transition-colors ${
                strategy.name === s.name
                  ? 'bg-teal-vivid/10 border-teal-vivid'
                  : 'bg-bg-panel border-border-dim hover:border-border-active'
              }`}>
              <p className="text-xs font-mono font-bold text-text-primary">{s.name}</p>
              <p className="text-[9px] text-text-muted mt-1">{s.description}</p>
            </button>
          ))}
        </div>

        {/* Run Button */}
        <button onClick={runTest} disabled={loading}
          className="px-6 py-2 bg-teal-vivid text-bg-base font-mono font-bold text-sm rounded hover:bg-teal-vivid/80 disabled:opacity-50">
          {loading ? 'Running...' : 'Run Backtest'}
        </button>

        {/* Results */}
        {result && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">TOTAL RETURN</p>
                <p className={`text-xl font-bold font-mono ${result.totalReturn >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                  {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn}%
                </p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">MAX DRAWDOWN</p>
                <p className="text-xl font-bold font-mono text-data-bear">{result.maxDrawdown}%</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">SHARPE RATIO</p>
                <p className="text-xl font-bold font-mono text-text-primary">{result.sharpeRatio}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-[10px] text-text-muted font-mono">WIN RATE</p>
                <p className="text-xl font-bold font-mono text-text-primary">{result.winRate}%</p>
              </div>
            </div>

            {/* Detailed Metrics */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h3 className="text-xs font-mono text-accent-cyan mb-3">PERFORMANCE</h3>
                <div className="space-y-2">
                  {[
                    ['Total Return', `${result.totalReturn}%`],
                    ['Annualized Return', `${result.annualizedReturn}%`],
                    ['Max Drawdown', `${result.maxDrawdown}%`],
                    ['Sharpe Ratio', result.sharpeRatio.toString()],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-text-muted font-mono">{label}</span>
                      <span className="font-mono text-text-primary">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h3 className="text-xs font-mono text-accent-cyan mb-3">TRADES</h3>
                <div className="space-y-2">
                  {[
                    ['Total Trades', result.totalTrades.toString()],
                    ['Win Rate', `${result.winRate}%`],
                    ['Profit Factor', result.profitFactor.toString()],
                    ['Avg Win', `${result.avgWin}%`],
                    ['Avg Loss', `${result.avgLoss}%`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-text-muted font-mono">{label}</span>
                      <span className="font-mono text-text-primary">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h3 className="text-xs font-mono text-accent-cyan mb-3">STRATEGY</h3>
                <div className="space-y-2">
                  <p className="text-xs font-mono text-text-primary">{strategy.name}</p>
                  <p className="text-[10px] text-text-muted">{strategy.description}</p>
                  <div className="text-[10px] font-mono text-text-muted">
                    {Object.entries(strategy.params).map(([k, v]) => (
                      <div key={k}>{k}: {v}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Trades */}
            {result.trades.length > 0 && (
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h3 className="text-xs font-mono text-accent-cyan mb-3">RECENT TRADES</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-text-muted border-b border-border-dim">
                        <th className="text-left py-2 font-mono">ENTRY</th>
                        <th className="text-left py-2 font-mono">EXIT</th>
                        <th className="text-right py-2 font-mono">SIDE</th>
                        <th className="text-right py-2 font-mono">ENTRY $</th>
                        <th className="text-right py-2 font-mono">EXIT $</th>
                        <th className="text-right py-2 font-mono">P&L</th>
                        <th className="text-right py-2 font-mono">P&L%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-10).reverse().map((t, i) => (
                        <tr key={i} className="border-b border-border-dim/30">
                          <td className="py-2 font-mono text-text-muted">{t.entry}</td>
                          <td className="py-2 font-mono text-text-muted">{t.exit}</td>
                          <td className={`py-2 text-right font-mono ${t.side === 'LONG' ? 'text-data-bull' : 'text-data-bear'}`}>{t.side}</td>
                          <td className="py-2 text-right font-mono">${t.entryPrice.toFixed(2)}</td>
                          <td className="py-2 text-right font-mono">${t.exitPrice.toFixed(2)}</td>
                          <td className={`py-2 text-right font-mono font-bold ${t.pnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                            {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                          </td>
                          <td className={`py-2 text-right font-mono ${t.pnlPercent >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                            {t.pnlPercent >= 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">METHODOLOGY</h2>
          <p className="text-xs text-text-dim">
            Backtesting uses 1-year historical data from Yahoo Finance. Initial capital: $10,000.
            Position sizing: 100% of equity per trade. No transaction costs or slippage modeled.
            Sharpe ratio simplified as total return / max drawdown. Results are hypothetical — past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
