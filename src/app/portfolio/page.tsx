"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Position {
  symbol: string
  name: string
  shares: number
  avgCost: number
  currentPrice: number
  value: number
  pnl: number
  pnlPercent: number
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

const DEFAULT_POSITIONS = [
  { symbol: 'AAPL', shares: 100, avgCost: 185 },
  { symbol: 'MSFT', shares: 50, avgCost: 420 },
  { symbol: 'NVDA', shares: 30, avgCost: 120 },
  { symbol: 'BBCA.JK', shares: 1000, avgCost: 9200 },
  { symbol: 'BBRI.JK', shares: 2000, avgCost: 4500 },
  { symbol: 'GLD', shares: 20, avgCost: 220 },
]

export default function PortfolioPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [risk, setRisk] = useState<RiskMetrics | null>(null)

  useEffect(() => {
    const symbols = DEFAULT_POSITIONS.map(p => p.symbol).join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`)
      .then(r => r.json())
      .then(d => {
        const quoteMap: Record<string, { price: number; name: string; beta: number }> = {}
        for (const q of d.data ?? []) {
          quoteMap[q.symbol] = {
            price: q.regularMarketPrice ?? 0,
            name: q.shortName ?? q.symbol,
            beta: q.beta ?? 1,
          }
        }

        const pos: Position[] = DEFAULT_POSITIONS.map(p => {
          const quote = quoteMap[p.symbol]
          const price = quote?.price ?? 0
          const value = p.shares * price
          const cost = p.shares * p.avgCost
          const pnl = value - cost
          return {
            symbol: p.symbol,
            name: quote?.name ?? p.symbol,
            shares: p.shares,
            avgCost: p.avgCost,
            currentPrice: price,
            value,
            pnl,
            pnlPercent: cost > 0 ? (pnl / cost) * 100 : 0,
            weight: 0,
          }
        })

        const totalValue = pos.reduce((s, p) => s + p.value, 0)
        pos.forEach(p => { p.weight = totalValue > 0 ? (p.value / totalValue) * 100 : 0 })

        setPositions(pos)

        // Compute risk metrics
        const totalCost = pos.reduce((s, p) => s + p.shares * p.avgCost, 0)
        const totalPnl = totalValue - totalCost
        const avgBeta = pos.reduce((s, p) => s + (quoteMap[p.symbol]?.beta ?? 1) * (p.weight / 100), 0)
        const maxWeight = Math.max(...pos.map(p => p.weight))

        // Simplified VaR (parametric, assuming 20% annual volatility for equities)
        const dailyVol = 0.20 / Math.sqrt(252)
        const dailyVaR95 = totalValue * 1.645 * dailyVol
        const dailyVaR99 = totalValue * 2.326 * dailyVol

        // Simplified Sharpe (assuming 5% risk-free rate, 15% expected return)
        const sharpe = dailyVol > 0 ? (0.15 - 0.05) / 0.20 : 0

        // Max drawdown estimate
        const maxDrawdown = totalValue * 0.15 // 15% estimated

        setRisk({
          totalValue,
          totalCost,
          totalPnl,
          totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
          dailyVaR95,
          dailyVaR99,
          sharpeRatio: sharpe,
          maxDrawdown,
          beta: avgBeta,
          volatility: dailyVol * Math.sqrt(252) * 100,
          concentrationRisk: maxWeight > 40 ? 'HIGH' : maxWeight > 25 ? 'MEDIUM' : 'LOW',
        })

        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const fmtB = (n: number) => {
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
    return `$${fmt(n)}`
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">PORTFOLIO RISK ANALYTICS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {positions.length} positions · VaR, Sharpe, Beta, concentration
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Computing portfolio risk...</div>
        ) : (
          <>
            {/* Summary Cards */}
            {risk && (
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <p className="text-[10px] text-text-muted font-mono">TOTAL VALUE</p>
                  <p className="text-xl font-bold font-mono text-text-primary">{fmtB(risk.totalValue)}</p>
                  <p className={`text-xs font-mono ${risk.totalPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                    {risk.totalPnl >= 0 ? '+' : ''}{fmtB(risk.totalPnl)} ({fmt(risk.totalPnlPercent)}%)
                  </p>
                </div>
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <p className="text-[10px] text-text-muted font-mono">DAILY VaR (95%)</p>
                  <p className="text-xl font-bold font-mono text-data-bear">{fmtB(risk.dailyVaR95)}</p>
                  <p className="text-xs font-mono text-text-muted">Max expected daily loss</p>
                </div>
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <p className="text-[10px] text-text-muted font-mono">SHARPE RATIO</p>
                  <p className="text-xl font-bold font-mono text-text-primary">{risk.sharpeRatio.toFixed(2)}</p>
                  <p className="text-xs font-mono text-text-muted">Risk-adjusted return</p>
                </div>
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <p className="text-[10px] text-text-muted font-mono">PORTFOLIO BETA</p>
                  <p className="text-xl font-bold font-mono text-text-primary">{risk.beta.toFixed(2)}</p>
                  <p className="text-xs font-mono text-text-muted">vs S&P 500</p>
                </div>
              </div>
            )}

            {/* Risk Metrics */}
            {risk && (
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <h3 className="text-xs font-mono text-accent-cyan mb-3">RISK METRICS</h3>
                  <div className="space-y-2">
                    {[
                      ['Daily VaR (95%)', fmtB(risk.dailyVaR95)],
                      ['Daily VaR (99%)', fmtB(risk.dailyVaR99)],
                      ['Annual Volatility', `${risk.volatility.toFixed(1)}%`],
                      ['Max Drawdown (est.)', fmtB(risk.maxDrawdown)],
                      ['Portfolio Beta', risk.beta.toFixed(2)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between text-xs">
                        <span className="text-text-muted font-mono">{label}</span>
                        <span className="font-mono text-text-primary">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <h3 className="text-xs font-mono text-accent-cyan mb-3">CONCENTRATION</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted font-mono">Risk Level</span>
                      <span className={`font-mono font-bold ${risk.concentrationRisk === 'HIGH' ? 'text-data-bear' : risk.concentrationRisk === 'MEDIUM' ? 'text-data-bull' : 'text-accent-cyan'}`}>
                        {risk.concentrationRisk}
                      </span>
                    </div>
                    {positions.sort((a, b) => b.weight - a.weight).slice(0, 3).map(p => (
                      <div key={p.symbol} className="flex justify-between text-xs">
                        <span className="text-text-muted font-mono">{p.symbol}</span>
                        <span className="font-mono text-text-primary">{p.weight.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <h3 className="text-xs font-mono text-accent-cyan mb-3">POSITIONS</h3>
                  <div className="space-y-2">
                    {[
                      ['Total Positions', positions.length.toString()],
                      ['Total Value', fmtB(risk.totalValue)],
                      ['Total Cost', fmtB(risk.totalCost)],
                      ['Unrealized P&L', fmtB(risk.totalPnl)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between text-xs">
                        <span className="text-text-muted font-mono">{label}</span>
                        <span className="font-mono text-text-primary">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Positions Table */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">POSITIONS</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <th className="text-left py-2 font-mono">SYMBOL</th>
                      <th className="text-left py-2 font-mono">NAME</th>
                      <th className="text-right py-2 font-mono">SHARES</th>
                      <th className="text-right py-2 font-mono">AVG COST</th>
                      <th className="text-right py-2 font-mono">CURRENT</th>
                      <th className="text-right py-2 font-mono">VALUE</th>
                      <th className="text-right py-2 font-mono">P&L</th>
                      <th className="text-right py-2 font-mono">WEIGHT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => (
                      <tr key={p.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 font-mono text-accent-cyan">{p.symbol}</td>
                        <td className="py-2 text-text-dim">{p.name}</td>
                        <td className="py-2 text-right font-mono">{p.shares.toLocaleString()}</td>
                        <td className="py-2 text-right font-mono">{fmt(p.avgCost)}</td>
                        <td className="py-2 text-right font-mono">{fmt(p.currentPrice)}</td>
                        <td className="py-2 text-right font-mono">{fmtB(p.value)}</td>
                        <td className={`py-2 text-right font-mono font-bold ${p.pnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {p.pnl >= 0 ? '+' : ''}{fmtB(p.pnl)} ({fmt(p.pnlPercent)}%)
                        </td>
                        <td className="py-2 text-right font-mono">{p.weight.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">METHODOLOGY</h2>
          <p className="text-xs text-text-dim">
            VaR: Parametric method, 95%/99% confidence, assuming 20% annual equity volatility.
            Sharpe: (Expected Return - Risk-Free Rate) / Annual Volatility, assuming 5% risk-free rate.
            Beta: Weighted average of individual stock betas from Yahoo Finance.
            All calculations are simplified estimates — not production-grade risk models.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
