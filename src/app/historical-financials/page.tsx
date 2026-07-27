"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface FinancialData {
  period: string
  revenue: number | null
  netIncome: number | null
  totalAssets: number | null
  totalLiabilities: number | null
  totalEquity: number | null
  operatingCashFlow: number | null
  capitalExpenditure: number | null
  freeCashFlow: number | null
}

const COMPANIES = [
  { ticker: 'AAPL', name: 'Apple' },
  { ticker: 'MSFT', name: 'Microsoft' },
  { ticker: 'GOOGL', name: 'Alphabet' },
  { ticker: 'AMZN', name: 'Amazon' },
  { ticker: 'NVDA', name: 'NVIDIA' },
  { ticker: 'META', name: 'Meta' },
  { ticker: 'TSLA', name: 'Tesla' },
  { ticker: 'JPM', name: 'JPMorgan' },
  { ticker: 'V', name: 'Visa' },
  { ticker: 'JNJ', name: 'J&J' },
  { ticker: 'WMT', name: 'Walmart' },
  { ticker: 'PG', name: 'P&G' },
  { ticker: 'XOM', name: 'Exxon' },
  { ticker: 'UNH', name: 'UnitedHealth' },
  { ticker: 'HD', name: 'Home Depot' },
  { ticker: 'DIS', name: 'Disney' },
  { ticker: 'NFLX', name: 'Netflix' },
  { ticker: 'BA', name: 'Boeing' },
  { ticker: 'GS', name: 'Goldman' },
  { ticker: 'BAC', name: 'BofA' },
]

export default function HistoricalFinancialsPage() {
  const [selected, setSelected] = useState('AAPL')
  const [data, setData] = useState<FinancialData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true)
    setError(null)
    fetch(`/api/v1/historical-financials?ticker=${selected}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d.data?.financials ?? [])
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [selected])

  const fmtB = (n: number | null) => {
    if (n == null) return '—'
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${n.toLocaleString()}`
  }

  const calcGrowth = (current: number | null, previous: number | null) => {
    if (current == null || previous == null || previous === 0) return null
    return ((current - previous) / Math.abs(previous)) * 100
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">HISTORICAL FINANCIALS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              SEC EDGAR XBRL data · {COMPANIES.length} companies · 20+ years of 10-K filings
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
        </div>

        {error && (
          <div className="text-data-bear text-[11px] font-mono p-4 bg-bg-panel border border-border-dim rounded">
            Error: {error}
          </div>
        )}

        {/* Company Selector */}
        <div className="flex flex-wrap gap-2">
          {COMPANIES.map(c => (
            <button key={c.ticker} onClick={() => setSelected(c.ticker)}
              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected === c.ticker ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold' : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {c.ticker}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading SEC EDGAR financial data for {selected}...</div>
        ) : data.length === 0 ? (
          <div className="text-text-dim text-xs p-8 text-center">No financial data available for {selected}</div>
        ) : (
          <div className="bg-bg-panel border border-border-dim rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <th className="text-left py-2 px-3 font-mono">Year</th>
                  <th className="text-right py-2 px-3 font-mono">Revenue</th>
                  <th className="text-right py-2 px-3 font-mono">YoY</th>
                  <th className="text-right py-2 px-3 font-mono">Net Income</th>
                  <th className="text-right py-2 px-3 font-mono">Total Assets</th>
                  <th className="text-right py-2 px-3 font-mono">Equity</th>
                  <th className="text-right py-2 px-3 font-mono">Op. Cash Flow</th>
                  <th className="text-right py-2 px-3 font-mono">CapEx</th>
                  <th className="text-right py-2 px-3 font-mono">FCF</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => {
                  const prev = data[i + 1]
                  const revGrowth = calcGrowth(row.revenue, prev?.revenue)
                  return (
                    <tr key={row.period} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 px-3 font-mono font-bold text-accent-cyan">{row.period}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtB(row.revenue)}</td>
                      <td className={`py-2 px-3 text-right font-mono ${revGrowth != null && revGrowth >= 0 ? 'text-accent-green' : revGrowth != null ? 'text-accent-red' : 'text-text-dim'}`}>
                        {revGrowth != null ? `${revGrowth >= 0 ? '+' : ''}${revGrowth.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{fmtB(row.netIncome)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtB(row.totalAssets)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtB(row.totalEquity)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtB(row.operatingCashFlow)}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtB(row.capitalExpenditure)}</td>
                      <td className={`py-2 px-3 text-right font-mono ${(row.freeCashFlow ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        {fmtB(row.freeCashFlow)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <p className="text-[9px] text-text-dim font-mono">
            Source: SEC EDGAR XBRL (data.sec.gov) · Annual 10-K filings only · All values in USD · FCF = Operating Cash Flow - CapEx
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
