"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'

// ─── Types ────────────────────────────────────────────────

interface OptionContract {
  instrument: string
  strike: number
  expiry: number
  expiryLabel: string
  optionType: 'call' | 'put'
  bid: number
  ask: number
  mark: number
  markIv: number
  bidIv: number
  askIv: number
  delta: number
  gamma: number
  theta: number
  vega: number
  rho: number
  openInterest: number
  volume: number
  underlyingPrice: number
}

interface OptionsChainData {
  currency: 'BTC' | 'ETH'
  indexPrice: number
  expiries: Array<{
    label: string
    timestamp: number
    daysToExpiry: number
    calls: OptionContract[]
    puts: OptionContract[]
  }>
  atmIv: number | null
  putCallRatio: number
  totalOI: number
  timestamp: number
}

interface AggregateData {
  btc: { indexPrice: number | null; fundingRate: number | null; openInterest: number | null; markPrice: number | null }
  eth: { indexPrice: number | null; fundingRate: number | null; openInterest: number | null; markPrice: number | null }
  optionInstruments: { btc: { puts: number; calls: number; total: number }; eth: { puts: number; calls: number; total: number } }
}

// ─── Helpers ──────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return n.toFixed(decimals)
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
}

function greekColor(n: number, invert = false): string {
  const val = invert ? -n : n
  if (val > 0.01) return 'text-accent-green'
  if (val < -0.01) return 'text-accent-red'
  return 'text-text-dim'
}

// ─── Black-Scholes Calculator (kept as secondary tool) ────

function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

function normPDF(x: number): number {
  return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
}

function blackScholes(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, price: 0 }
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  const nd1 = normPDF(d1)
  const Nd1 = normCDF(d1)
  const Nd2 = normCDF(d2)
  const sqrtT = Math.sqrt(T)
  const expRT = Math.exp(-r * T)

  if (isCall) {
    return {
      price: S * Nd1 - K * expRT * Nd2,
      delta: Nd1,
      gamma: nd1 / (S * sigma * sqrtT),
      theta: -(S * nd1 * sigma) / (2 * sqrtT) - r * K * expRT * Nd2,
      vega: S * nd1 * sqrtT,
      rho: K * T * expRT * Nd2,
    }
  }
  return {
    price: K * expRT * (1 - Nd2) - S * (1 - Nd1),
    delta: Nd1 - 1,
    gamma: nd1 / (S * sigma * sqrtT),
    theta: -(S * nd1 * sigma) / (2 * sqrtT) + r * K * expRT * (1 - Nd2),
    vega: S * nd1 * sqrtT,
    rho: -K * T * expRT * (1 - Nd2),
  }
}

// ─── Main Page ────────────────────────────────────────────

export default function OptionsPage() {
  const [currency, setCurrency] = useState<'BTC' | 'ETH'>('BTC')
  const [chainData, setChainData] = useState<OptionsChainData | null>(null)
  const [aggData, setAggData] = useState<AggregateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedExpiry, setSelectedExpiry] = useState(0)
  const [showCalc, setShowCalc] = useState(false)

  // Calculator inputs
  const [calcStrike, setCalcStrike] = useState('')
  const [calcExpiry, setCalcExpiry] = useState('30')
  const [calcIv, setCalcIv] = useState('60')
  const [calcIsCall, setCalcIsCall] = useState(true)

  const fetchChain = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [chainRes, aggRes] = await Promise.all([
        fetch(`/api/v1/modules/fetch?module=deribit-options&action=options-chain&currency=${currency}`),
        fetch(`/api/v1/modules/fetch?module=deribit-options`),
      ])
      const chainJson = await chainRes.json()
      const aggJson = await aggRes.json()

      if (chainJson.data) setChainData(chainJson.data)
      else setError('Failed to load options chain')

      if (aggJson.data) setAggData(aggJson.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [currency])

  useEffect(() => { fetchChain() }, [fetchChain])

  // Reset selectedExpiry when data changes
  useEffect(() => {
    if (chainData && selectedExpiry >= chainData.expiries.length) setSelectedExpiry(0)
  }, [chainData, selectedExpiry])

  const expiry = chainData?.expiries[selectedExpiry]
  const indexPrice = chainData?.indexPrice ?? aggData?.[currency.toLowerCase() as 'btc' | 'eth']?.indexPrice ?? 0

  // Merge calls and puts by strike for the options chain table
  const strikeMap = new Map<number, { call?: OptionContract; put?: OptionContract }>()
  if (expiry) {
    for (const c of expiry.calls) {
      let entry = strikeMap.get(c.strike)
      if (!entry) { entry = {}; strikeMap.set(c.strike, entry) }
      entry.call = c
    }
    for (const p of expiry.puts) {
      let entry = strikeMap.get(p.strike)
      if (!entry) { entry = {}; strikeMap.set(p.strike, entry) }
      entry.put = p
    }
  }
  const strikes = Array.from(strikeMap.entries()).sort((a, b) => a[0] - b[0])

  // BS calculator result
  const calcResult = (() => {
    const S = indexPrice || 100000
    const K = parseFloat(calcStrike) || S
    const T = parseFloat(calcExpiry) / 365
    const sigma = parseFloat(calcIv) / 100
    return blackScholes(S, K, T, 0.05, sigma, calcIsCall)
  })()

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">OPTIONS CHAIN</h1>
            <p className="text-xs text-text-muted font-mono">
              Real-time Deribit options data — bid/ask, IV, Greeks, OI
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Currency toggle */}
            {(['BTC', 'ETH'] as const).map(c => (
              <button key={c} onClick={() => setCurrency(c)}
                className={`px-3 py-1 text-xs font-mono rounded ${currency === c ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary bg-bg-elevated'}`}>
                {c}
              </button>
            ))}
            <button onClick={fetchChain} className="px-2 py-1 text-xs font-mono text-text-muted hover:text-text-primary">
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="text-data-bear text-[11px] font-mono p-3 bg-bg-panel rounded">Error: {error}</div>}

        {/* Summary strip */}
        {chainData && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">INDEX PRICE</p>
              <p className="text-lg font-mono font-bold">${fmt(indexPrice, 2)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">ATM IV</p>
              <p className="text-lg font-mono font-bold">{chainData.atmIv?.toFixed(1) ?? '—'}%</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">PUT/CALL RATIO</p>
              <p className="text-lg font-mono font-bold">{chainData.putCallRatio.toFixed(2)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">TOTAL OI</p>
              <p className="text-lg font-mono font-bold">{fmt(chainData.totalOI, 0)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">FUNDING RATE</p>
              <p className="text-lg font-mono font-bold">{aggData?.[currency.toLowerCase() as 'btc' | 'eth']?.fundingRate != null ? fmtPct(aggData[currency.toLowerCase() as 'btc' | 'eth'].fundingRate!) : '—'}</p>
            </div>
          </div>
        )}

        {/* Expiry tabs */}
        {chainData && chainData.expiries.length > 0 && (
          <div className="flex items-center gap-1.5">
            {chainData.expiries.map((exp, i) => (
              <button key={exp.label} onClick={() => setSelectedExpiry(i)}
                className={`px-3 py-1.5 text-[11px] font-mono rounded transition-colors ${
                  selectedExpiry === i ? 'bg-teal-dim/30 text-teal-vivid font-bold' : 'text-text-muted hover:text-text-secondary'
                }`}>
                {exp.label} ({exp.daysToExpiry}d)
              </button>
            ))}
            <button onClick={() => setShowCalc(!showCalc)}
              className={`ml-auto px-3 py-1.5 text-[10px] font-mono rounded ${showCalc ? 'bg-accent-amber/20 text-accent-amber' : 'text-text-muted hover:text-text-secondary'}`}>
              BS Calc
            </button>
          </div>
        )}

        {/* BS Calculator (collapsible) */}
        {showCalc && (
          <div className="bg-bg-panel border border-accent-amber/30 rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-amber mb-3">BLACK-SCHOLES CALCULATOR</h3>
            <div className="grid grid-cols-5 gap-3 mb-3">
              <div>
                <label className="text-[9px] text-text-muted font-mono block mb-1">Underlying</label>
                <input type="text" value={`$${fmt(indexPrice)}`} readOnly className="w-full px-2 py-1.5 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-muted" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted font-mono block mb-1">Strike</label>
                <input type="number" value={calcStrike} onChange={e => setCalcStrike(e.target.value)} placeholder={fmt(indexPrice)} className="w-full px-2 py-1.5 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted font-mono block mb-1">Days to Expiry</label>
                <input type="number" value={calcExpiry} onChange={e => setCalcExpiry(e.target.value)} className="w-full px-2 py-1.5 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted font-mono block mb-1">IV (%)</label>
                <input type="number" value={calcIv} onChange={e => setCalcIv(e.target.value)} className="w-full px-2 py-1.5 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted font-mono block mb-1">Type</label>
                <select value={calcIsCall ? 'call' : 'put'} onChange={e => setCalcIsCall(e.target.value === 'call')} className="w-full px-2 py-1.5 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
                  <option value="call">Call</option><option value="put">Put</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-3 text-center">
              <div><p className="text-[9px] text-text-muted">PRICE</p><p className="text-sm font-mono font-bold">${calcResult.price.toFixed(2)}</p></div>
              <div><p className="text-[9px] text-text-muted">DELTA</p><p className="text-sm font-mono">{calcResult.delta.toFixed(4)}</p></div>
              <div><p className="text-[9px] text-text-muted">GAMMA</p><p className="text-sm font-mono">{calcResult.gamma.toFixed(6)}</p></div>
              <div><p className="text-[9px] text-text-muted">THETA</p><p className="text-sm font-mono text-data-bear">{calcResult.theta.toFixed(2)}</p></div>
              <div><p className="text-[9px] text-text-muted">VEGA</p><p className="text-sm font-mono">{calcResult.vega.toFixed(2)}</p></div>
              <div><p className="text-[9px] text-text-muted">RHO</p><p className="text-sm font-mono">{calcResult.rho.toFixed(2)}</p></div>
            </div>
          </div>
        )}

        {/* Options Chain Table */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading {currency} options chain from Deribit...</div>
        ) : expiry && strikes.length > 0 ? (
          <div className="bg-bg-panel border border-border-dim rounded-lg overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="border-b border-border-dim text-text-muted">
                  <th colSpan={7} className="text-center py-1.5 text-accent-green border-r border-border-dim">{currency} CALLS</th>
                  <th className="text-center py-1.5 text-text-primary px-2">STRIKE</th>
                  <th colSpan={7} className="text-center py-1.5 text-accent-red border-l border-border-dim">{currency} PUTS</th>
                </tr>
                <tr className="border-b border-border-dim text-text-muted">
                  <th className="text-right py-1 px-1">Bid</th>
                  <th className="text-right py-1 px-1">Ask</th>
                  <th className="text-right py-1 px-1">Mark</th>
                  <th className="text-right py-1 px-1">IV%</th>
                  <th className="text-right py-1 px-1">Delta</th>
                  <th className="text-right py-1 px-1">OI</th>
                  <th className="text-right py-1 px-1 border-r border-border-dim">Vol</th>
                  <th className="text-center py-1 px-2 text-text-primary font-bold"></th>
                  <th className="text-right py-1 px-1">Vol</th>
                  <th className="text-right py-1 px-1">OI</th>
                  <th className="text-right py-1 px-1">Delta</th>
                  <th className="text-right py-1 px-1">IV%</th>
                  <th className="text-right py-1 px-1">Mark</th>
                  <th className="text-right py-1 px-1">Ask</th>
                  <th className="text-right py-1 px-1">Bid</th>
                </tr>
              </thead>
              <tbody>
                {strikes.map(([strike, { call, put }]) => {
                  const isATM = Math.abs(strike - indexPrice) < indexPrice * 0.02
                  return (
                    <tr key={strike} className={`border-b border-border-dim/30 hover:bg-bg-elevated ${isATM ? 'bg-teal-vivid/5' : ''}`}>
                      {/* Calls */}
                      <td className="text-right py-1 px-1 text-accent-green">{call?.bid?.toFixed(1) ?? '—'}</td>
                      <td className="text-right py-1 px-1 text-accent-green">{call?.ask?.toFixed(1) ?? '—'}</td>
                      <td className="text-right py-1 px-1">{call?.mark?.toFixed(1) ?? '—'}</td>
                      <td className="text-right py-1 px-1">{call?.markIv?.toFixed(1) ?? '—'}</td>
                      <td className={`text-right py-1 px-1 ${greekColor(call?.delta ?? 0)}`}>{call?.delta?.toFixed(3) ?? '—'}</td>
                      <td className="text-right py-1 px-1">{call?.openInterest ? fmt(call.openInterest, 0) : '—'}</td>
                      <td className="text-right py-1 px-1 border-r border-border-dim">{call?.volume ?? '—'}</td>
                      {/* Strike */}
                      <td className={`text-center py-1 px-2 font-bold ${isATM ? 'text-teal-vivid' : 'text-text-primary'}`}>
                        {strike.toLocaleString()} {isATM ? '*' : ''}
                      </td>
                      {/* Puts */}
                      <td className="text-right py-1 px-1">{put?.volume ?? '—'}</td>
                      <td className="text-right py-1 px-1">{put?.openInterest ? fmt(put.openInterest, 0) : '—'}</td>
                      <td className={`text-right py-1 px-1 ${greekColor(put?.delta ?? 0)}`}>{put?.delta?.toFixed(3) ?? '—'}</td>
                      <td className="text-right py-1 px-1">{put?.markIv?.toFixed(1) ?? '—'}</td>
                      <td className="text-right py-1 px-1">{put?.mark?.toFixed(1) ?? '—'}</td>
                      <td className="text-right py-1 px-1 text-accent-red">{put?.ask?.toFixed(1) ?? '—'}</td>
                      <td className="text-right py-1 px-1 text-accent-red">{put?.bid?.toFixed(1) ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && <div className="text-text-dim text-xs p-8 text-center">No options chain data available for {currency}</div>
        )}

        {/* Greeks legend */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
          <h2 className="text-[10px] font-mono text-accent-cyan mb-2">GREEKS</h2>
          <div className="grid grid-cols-5 gap-2 text-[9px] text-text-dim">
            <div><span className="text-text-primary font-bold">Delta</span> — Price sensitivity to $1 move in underlying</div>
            <div><span className="text-text-primary font-bold">Gamma</span> — Rate of change of delta</div>
            <div><span className="text-text-primary font-bold">Theta</span> — Time decay per day (negative = losing value)</div>
            <div><span className="text-text-primary font-bold">Vega</span> — Sensitivity to 1% change in IV</div>
            <div><span className="text-text-primary font-bold">Rho</span> — Sensitivity to 1% change in interest rate</div>
          </div>
        </div>

        <div className="text-[9px] text-text-muted font-mono">
          Data: Deribit Public API (unofficial). {strikes.length} strikes for {expiry?.label ?? '—'}. Prices delayed ~1s. ATM strikes marked with *.
        </div>
      </div>
    </NexusLayout>
  )
}
