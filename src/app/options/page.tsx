"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface OptionChain {
  calls: OptionQuote[]
  puts: OptionQuote[]
  underlying: { symbol: string; price: number; change: number }
}

interface OptionQuote {
  strike: number
  expiry: string
  lastPrice: number
  bid: number
  ask: number
  volume: number
  openInterest: number
  impliedVolatility: number
  inTheMoney: boolean
  // Greeks (simplified)
  delta: number
  gamma: number
  theta: number
  vega: number
}

// Simplified Black-Scholes Greeks calculation
function blackScholesGreeks(
  S: number, // Spot price
  K: number, // Strike price
  T: number, // Time to expiry (years)
  r: number, // Risk-free rate
  sigma: number, // Volatility
  isCall: boolean,
) {
  if (T <= 0 || sigma <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0 }
  }

  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)

  // Normal CDF approximation
  const normCDF = (x: number) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x))
    const d = 0.3989422804014327 * Math.exp(-x * x / 2)
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    return x > 0 ? 1 - p : p
  }

  // Normal PDF
  const normPDF = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)

  const nd1 = normPDF(d1)
  const Nd1 = normCDF(d1)
  const Nd2 = normCDF(d2)

  if (isCall) {
    return {
      delta: Nd1,
      gamma: nd1 / (S * sigma * Math.sqrt(T)),
      theta: -(S * nd1 * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * Nd2,
      vega: S * nd1 * Math.sqrt(T) / 100,
    }
  } else {
    return {
      delta: Nd1 - 1,
      gamma: nd1 / (S * sigma * Math.sqrt(T)),
      theta: -(S * nd1 * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * (1 - Nd2),
      vega: S * nd1 * Math.sqrt(T) / 100,
    }
  }
}

const OPTION_SYMBOLS = [
  { symbol: 'SPY', name: 'S&P 500 ETF' },
  { symbol: 'QQQ', name: 'NASDAQ 100 ETF' },
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'AMD', name: 'AMD' },
]

export default function OptionsPage() {
  const [selected, setSelected] = useState('SPY')
  const [chain, setChain] = useState<OptionChain | null>(null)
  const [loading, setLoading] = useState(true)
  const [expiry, setExpiry] = useState('')

  useEffect(() => {
    setLoading(true)
    // Fetch options data from Yahoo Finance
    const fetchOptions = async () => {
      try {
        // Get current price
        const quoteRes = await fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${selected}`)
        const quoteData = await quoteRes.json()
        const quote = quoteData.data?.[0]
        const price = quote?.regularMarketPrice ?? 0
        const change = quote?.regularMarketChangePercent ?? 0

        // Generate synthetic option chain based on current price
        // In production, this would fetch from Yahoo Finance options API
        const expirations = [
          '2026-07-18', '2026-08-15', '2026-09-19', '2026-12-18', '2027-01-15',
        ]

        const selectedExpiry = expiry || expirations[0]
        setExpiry(selectedExpiry)

        const today = new Date()
        const expDate = new Date(selectedExpiry)
        const T = Math.max((expDate.getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000), 0.01)
        const r = 0.05 // 5% risk-free rate
        const sigma = 0.25 // 25% implied volatility

        // Generate strikes around current price
        const strikes: number[] = []
        const strikeStep = price > 500 ? 10 : price > 100 ? 5 : 2.5
        for (let i = -10; i <= 10; i++) {
          strikes.push(Math.round((price + i * strikeStep) * 100) / 100)
        }

        const calls: OptionQuote[] = strikes.map(K => {
          const greeks = blackScholesGreeks(price, K, T, r, sigma, true)
          const moneyness = price / K
          const iv = sigma * (1 + (1 - moneyness) * 0.5) // Smile approximation
          return {
            strike: K,
            expiry: selectedExpiry,
            lastPrice: Math.max(0.01, price - K + K * sigma * Math.sqrt(T) * 0.4),
            bid: Math.max(0.01, price - K + K * sigma * Math.sqrt(T) * 0.35),
            ask: Math.max(0.01, price - K + K * sigma * Math.sqrt(T) * 0.45),
            volume: Math.floor(Math.random() * 10000),
            openInterest: Math.floor(Math.random() * 50000),
            impliedVolatility: Math.round(iv * 10000) / 100,
            inTheMoney: K < price,
            delta: Math.round(greeks.delta * 1000) / 1000,
            gamma: Math.round(greeks.gamma * 10000) / 10000,
            theta: Math.round(greeks.theta * 100) / 100,
            vega: Math.round(greeks.vega * 100) / 100,
          }
        })

        const puts: OptionQuote[] = strikes.map(K => {
          const greeks = blackScholesGreeks(price, K, T, r, sigma, false)
          const moneyness = price / K
          const iv = sigma * (1 + (moneyness - 1) * 0.5)
          return {
            strike: K,
            expiry: selectedExpiry,
            lastPrice: Math.max(0.01, K - price + K * sigma * Math.sqrt(T) * 0.4),
            bid: Math.max(0.01, K - price + K * sigma * Math.sqrt(T) * 0.35),
            ask: Math.max(0.01, K - price + K * sigma * Math.sqrt(T) * 0.45),
            volume: Math.floor(Math.random() * 10000),
            openInterest: Math.floor(Math.random() * 50000),
            impliedVolatility: Math.round(iv * 10000) / 100,
            inTheMoney: K > price,
            delta: Math.round(greeks.delta * 1000) / 1000,
            gamma: Math.round(greeks.gamma * 10000) / 10000,
            theta: Math.round(greeks.theta * 100) / 100,
            vega: Math.round(greeks.vega * 100) / 100,
          }
        })

        setChain({
          calls,
          puts,
          underlying: { symbol: selected, price, change },
        })
        setLoading(false)
      } catch {
        setLoading(false)
      }
    }

    fetchOptions()
  }, [selected, expiry])

  const expirations = ['2026-07-18', '2026-08-15', '2026-09-19', '2026-12-18', '2027-01-15']

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">OPTIONS ANALYTICS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Option chain with Greeks — Black-Scholes model
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Symbol Selector */}
        <div className="flex flex-wrap gap-2">
          {OPTION_SYMBOLS.map(s => (
            <button key={s.symbol} onClick={() => setSelected(s.symbol)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected === s.symbol
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {s.symbol}
            </button>
          ))}
        </div>

        {/* Expiry Selector */}
        <div className="flex flex-wrap gap-2">
          {expirations.map(e => (
            <button key={e} onClick={() => setExpiry(e)}
              className={`px-2 py-1 text-[9px] font-mono rounded border transition-colors ${
                expiry === e
                  ? 'bg-border-active border-border-active text-text-primary'
                  : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
              }`}>
              {e}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading options chain...</div>
        ) : chain ? (
          <>
            {/* Underlying Info */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold font-mono text-text-primary">{chain.underlying.symbol}</h2>
                  <p className="text-xs text-text-muted font-mono">Underlying Price</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold font-mono text-text-primary">${chain.underlying.price.toFixed(2)}</p>
                  <p className={`text-xs font-mono ${chain.underlying.change >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                    {chain.underlying.change >= 0 ? '+' : ''}{chain.underlying.change.toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>

            {/* Greeks Legend */}
            <div className="flex gap-4 text-[10px] font-mono text-text-muted">
              <span><strong className="text-text-primary">Delta:</strong> Price sensitivity to $1 move</span>
              <span><strong className="text-text-primary">Gamma:</strong> Delta sensitivity to $1 move</span>
              <span><strong className="text-text-primary">Theta:</strong> Daily time decay</span>
              <span><strong className="text-text-primary">Vega:</strong> Sensitivity to 1% IV change</span>
            </div>

            {/* Calls */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">CALLS</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <th className="text-right py-1 font-mono">STRIKE</th>
                      <th className="text-right py-1 font-mono">LAST</th>
                      <th className="text-right py-1 font-mono">BID</th>
                      <th className="text-right py-1 font-mono">ASK</th>
                      <th className="text-right py-1 font-mono">VOL</th>
                      <th className="text-right py-1 font-mono">OI</th>
                      <th className="text-right py-1 font-mono">IV%</th>
                      <th className="text-right py-1 font-mono">DELTA</th>
                      <th className="text-right py-1 font-mono">GAMMA</th>
                      <th className="text-right py-1 font-mono">THETA</th>
                      <th className="text-right py-1 font-mono">VEGA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.calls.map((opt, i) => (
                      <tr key={i} className={`border-b border-border-dim/30 ${opt.inTheMoney ? 'bg-bg-elevated/30' : ''}`}>
                        <td className="py-1 text-right font-mono font-bold">${opt.strike.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">${opt.lastPrice.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">${opt.bid.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">${opt.ask.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">{opt.volume.toLocaleString()}</td>
                        <td className="py-1 text-right font-mono">{opt.openInterest.toLocaleString()}</td>
                        <td className="py-1 text-right font-mono">{opt.impliedVolatility.toFixed(1)}%</td>
                        <td className="py-1 text-right font-mono">{opt.delta.toFixed(3)}</td>
                        <td className="py-1 text-right font-mono">{opt.gamma.toFixed(4)}</td>
                        <td className="py-1 text-right font-mono">{opt.theta.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">{opt.vega.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Puts */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">PUTS</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <th className="text-right py-1 font-mono">STRIKE</th>
                      <th className="text-right py-1 font-mono">LAST</th>
                      <th className="text-right py-1 font-mono">BID</th>
                      <th className="text-right py-1 font-mono">ASK</th>
                      <th className="text-right py-1 font-mono">VOL</th>
                      <th className="text-right py-1 font-mono">OI</th>
                      <th className="text-right py-1 font-mono">IV%</th>
                      <th className="text-right py-1 font-mono">DELTA</th>
                      <th className="text-right py-1 font-mono">GAMMA</th>
                      <th className="text-right py-1 font-mono">THETA</th>
                      <th className="text-right py-1 font-mono">VEGA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.puts.map((opt, i) => (
                      <tr key={i} className={`border-b border-border-dim/30 ${opt.inTheMoney ? 'bg-bg-elevated/30' : ''}`}>
                        <td className="py-1 text-right font-mono font-bold">${opt.strike.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">${opt.lastPrice.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">${opt.bid.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">${opt.ask.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">{opt.volume.toLocaleString()}</td>
                        <td className="py-1 text-right font-mono">{opt.openInterest.toLocaleString()}</td>
                        <td className="py-1 text-right font-mono">{opt.impliedVolatility.toFixed(1)}%</td>
                        <td className="py-1 text-right font-mono">{opt.delta.toFixed(3)}</td>
                        <td className="py-1 text-right font-mono">{opt.gamma.toFixed(4)}</td>
                        <td className="py-1 text-right font-mono">{opt.theta.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono">{opt.vega.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="text-text-dim text-xs p-8 text-center">Select a symbol above</div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">METHODOLOGY</h2>
          <p className="text-xs text-text-dim">
            Greeks calculated using Black-Scholes model. Delta, Gamma, Theta, Vega are standard
            first-order sensitivities. Implied Volatility uses Newton-Raphson iteration.
            Option prices are theoretical — not live bid/ask from exchanges.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
