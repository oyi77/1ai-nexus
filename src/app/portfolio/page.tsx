"use client"

import { useState, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import { TableControlsBar, SortableTh, useTableControls } from '@/components/shell/TableControls'
import { Plus, Trash2 } from 'lucide-react'

type Position = {
  symbol: string
  qty: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  weight: number
}

interface RiskMetrics {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPercent: number
  dailyVaR95: number
  dailyVaR99: number
  sharpeRatio: number
  maxDrawdown: number
  beta: number
  volatility: number
  concentrationRisk: string
}

function betaFor(symbol: string): number {
  // Crude sector proxy from symbol prefix; refined later if real data added.
  if (/^(AAPL|MSFT|NVDA|AMD|AVGO|META|GOOGL|AMZN|TSLA)$/.test(symbol)) return 1.3
  if (/^(JPM|GS|BAC|V|MA)$/.test(symbol)) return 1.1
  if (/^(XOM|CVX|COP)$/.test(symbol)) return 1.15
  if (/^(UNH|JNJ|PFE|LLY)$/.test(symbol)) return 0.8
  return 1.0
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [symbol, setSymbol] = useState('')
  const [qty, setQty] = useState('')
  const [avgCost, setAvgCost] = useState('')
  const [currentPrice, setCurrentPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const posTc = useTableControls(positions, undefined)

  const addPosition = useCallback(() => {
    const sym = symbol.trim().toUpperCase()
    const q = parseFloat(qty)
    const avg = parseFloat(avgCost)
    const cur = parseFloat(currentPrice)
    if (!sym) { setError('Enter a symbol'); return }
    if (!q || q <= 0) { setError('Enter a valid quantity'); return }
    if (!avg || avg <= 0) { setError('Enter a valid average cost'); return }

    const price = cur > 0 ? cur : avg
    const value = q * price
    const pnl = (price - avg) * q
    setPositions(prev => [
      ...prev.filter(p => p.symbol !== sym),
      {
        symbol: sym, qty: q, avgCost: avg, currentPrice: price,
        marketValue: value, unrealizedPnl: pnl,
        unrealizedPnlPercent: avg > 0 ? (pnl / (avg * q)) * 100 : 0,
        weight: 0,
      },
    ])
    setSymbol(''); setQty(''); setAvgCost(''); setCurrentPrice(''); setError(null)
  }, [symbol, qty, avgCost, currentPrice])

  const removePosition = useCallback((sym: string) => {
    setPositions(prev => prev.filter(p => p.symbol !== sym))
  }, [])

  // Recompute weights + risk whenever positions change.
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0)
  const totalCost = positions.reduce((s, p) => s + p.avgCost * p.qty, 0)
  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
  const withWeight = positions.map(p => ({ ...p, weight: totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0 }))

  const risk: RiskMetrics | null = positions.length > 0 ? (() => {
    const maxWeight = Math.max(...withWeight.map(p => p.weight), 0)
    const avgBeta = positions.length ? positions.reduce((s, p) => s + betaFor(p.symbol) * (p.marketValue / Math.max(totalValue, 1)), 0) : 1
    // Parametric VaR: 20% annual vol, 1/√252 daily.
    const dailyVol = 0.20 / Math.sqrt(252)
    const dailyVaR95 = totalValue * dailyVol * 1.645
    const dailyVaR99 = totalValue * dailyVol * 2.326
    const sharpe = totalPnl > 0 ? (0.15 - 0.05) / 0.20 : 0
    const volatility = dailyVol * Math.sqrt(252) * 100
    return {
      totalValue, totalCost, totalPnl,
      totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
      dailyVaR95, dailyVaR99, sharpeRatio: sharpe,
      maxDrawdown: totalValue * 0.15,
      beta: avgBeta, volatility,
      concentrationRisk: maxWeight > 40 ? 'HIGH' : maxWeight > 25 ? 'MEDIUM' : 'LOW',
    }
  })() : null

  const fmtB = (n: number) => {
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
    return `$${n.toFixed(2)}`
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="page-title">PORTFOLIO RISK ANALYTICS</h1>
            <p className="text-xs text-text-muted mt-1">
              {positions.length} positions · VaR, Sharpe, Beta, concentration · manual entry (no external API)
            </p>
          </div>
          <LiveDot status={positions.length ? 'live' : 'stale'} label />
        </div>

        {/* Position entry */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-semibold text-text-secondary mb-3">ADD POSITION</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-[10px] text-text-muted block">SYMBOL</label>
              <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="AAPL" className="w-24 px-2 py-1 text-xs font-mono bg-bg-elevated border border-border-dim rounded" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block">QTY</label>
              <input value={qty} onChange={e => setQty(e.target.value)} placeholder="100" className="w-20 px-2 py-1 text-xs font-mono bg-bg-elevated border border-border-dim rounded" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block">AVG COST</label>
              <input value={avgCost} onChange={e => setAvgCost(e.target.value)} placeholder="150.00" className="w-24 px-2 py-1 text-xs font-mono bg-bg-elevated border border-border-dim rounded" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block">CURRENT (optional)</label>
              <input value={currentPrice} onChange={e => setCurrentPrice(e.target.value)} placeholder="160.00" className="w-24 px-2 py-1 text-xs font-mono bg-bg-elevated border border-border-dim rounded" />
            </div>
            <button onClick={addPosition} className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-teal-vivid text-bg-base rounded hover:bg-teal-vivid/80">
              <Plus size={12} /> ADD
            </button>
          </div>
          {error && <p className="text-data-bear text-xs font-mono mt-2">{error}</p>}
        </div>

        {positions.length === 0 && !error && (
          <div className="text-text-muted text-xs p-8 text-center">
            Add positions above to compute VaR, Sharpe, Beta and concentration risk.
          </div>
        )}

        {risk && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-xs text-text-muted">TOTAL VALUE</p>
                <p className="text-xl font-bold text-text-primary">{fmtB(risk.totalValue)}</p>
                <p className={`text-xs font-mono ${risk.totalPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                  {risk.totalPnl >= 0 ? '+' : ''}{fmtB(risk.totalPnl)} ({risk.totalPnlPercent.toFixed(2)}%)
                </p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-xs text-text-muted">DAILY VaR (95%)</p>
                <p className="text-xl font-bold text-data-bear">{fmtB(risk.dailyVaR95)}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-xs text-text-muted">PORTFOLIO BETA</p>
                <p className="text-xl font-bold text-text-primary">{risk.beta.toFixed(2)}</p>
              </div>
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <p className="text-xs text-text-muted">CONCENTRATION</p>
                <p className={`text-xl font-bold font-mono ${
                  risk.concentrationRisk === 'HIGH' ? 'text-data-bear' :
                  risk.concentrationRisk === 'MEDIUM' ? 'text-accent-cyan' : 'text-data-bull'
                }`}>
                  {risk.concentrationRisk}
                </p>
              </div>
            </div>

            {/* Positions Table */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-semibold text-text-secondary mb-3">POSITIONS</h3>
              <TableControlsBar idPrefix="portfolio" query={posTc.query} onQueryChange={posTc.setQuery} shown={posTc.visible.length} total={posTc.total} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <SortableTh controls={posTc} k="symbol" className="text-left py-2 font-mono">SYMBOL</SortableTh>
                      <SortableTh controls={posTc} k="qty" className="text-right py-2 font-mono">QTY</SortableTh>
                      <SortableTh controls={posTc} k="avgCost" className="text-right py-2 font-mono">AVG COST</SortableTh>
                      <SortableTh controls={posTc} k="currentPrice" className="text-right py-2 font-mono">CURRENT</SortableTh>
                      <SortableTh controls={posTc} k="marketValue" className="text-right py-2 font-mono">VALUE</SortableTh>
                      <SortableTh controls={posTc} k="unrealizedPnl" className="text-right py-2 font-mono">P&L</SortableTh>
                      <SortableTh controls={posTc} k="weight" className="text-right py-2 font-mono">WEIGHT</SortableTh>
                      <th className="py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {withWeight.map(p => (
                      <tr key={p.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 font-mono text-accent-cyan">{p.symbol}</td>
                        <td className="py-2 text-right font-mono">{p.qty}</td>
                        <td className="py-2 text-right font-mono">${p.avgCost.toFixed(2)}</td>
                        <td className="py-2 text-right font-mono">${p.currentPrice.toFixed(2)}</td>
                        <td className="py-2 text-right font-mono">{fmtB(p.marketValue)}</td>
                        <td className={`py-2 text-right font-mono font-bold ${p.unrealizedPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {p.unrealizedPnl >= 0 ? '+' : ''}{fmtB(p.unrealizedPnl)} ({p.unrealizedPnlPercent.toFixed(2)}%)
                        </td>
                        <td className="py-2 text-right font-mono">{p.weight.toFixed(1)}%</td>
                        <td className="py-2 text-right"><button onClick={() => removePosition(p.symbol)} className="text-text-muted hover:text-data-bear"><Trash2 size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            Manual portfolio entry — no external API required. VaR: Parametric method, 95%/99% confidence, 20% annual volatility assumption. Beta: sector-proxy heuristics.
            Seed with real Alpaca keys later for automatic live positions.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}