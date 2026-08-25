"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Fundamentals {
  symbol: string
  name: string
  sector: string
  industry: string
  marketCap: number
  enterpriseValue: number
  trailingPE: number | null
  forwardPE: number | null
  pegRatio: number | null
  priceToBook: number | null
  priceToSales: number | null
  evToRevenue: number | null
  evToEbitda: number | null
  revenue: number | null
  revenueGrowth: number | null
  grossMargin: number | null
  ebitdaMargin: number | null
  operatingMargin: number | null
  profitMargin: number | null
  returnOnEquity: number | null
  returnOnAssets: number | null
  debtToEquity: number | null
  currentRatio: number | null
  dividendYield: number | null
  payoutRatio: number | null
  beta: number | null
  shortRatio: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  averageVolume: number | null
  totalCash: number | null
  totalDebt: number | null
  freeCashflow: number | null
  operatingCashflow: number | null
}

import { ANALYSIS_WATCHLIST as WATCHLIST } from '@/lib/config/universe'

export default function FundamentalsPage() {
  const [data, setData] = useState<Fundamentals[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('AAPL')
  const [detail, setDetail] = useState<Fundamentals | null>(null)

  useEffect(() => {
    const symbols = WATCHLIST.join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`)
      .then(r => r.json())
      .then(d => {
        const items: Fundamentals[] = (d.data ?? []).map((q: Record<string, unknown>) => ({
          symbol: q.symbol as string,
          name: (q.shortName ?? q.longName ?? q.symbol) as string,
          sector: (q.sector ?? 'Unknown') as string,
          industry: (q.industry ?? 'Unknown') as string,
          marketCap: (q.marketCap ?? 0) as number,
          enterpriseValue: (q.enterpriseValue ?? 0) as number,
          trailingPE: q.trailingPE as number | null,
          forwardPE: q.forwardPE as number | null,
          pegRatio: q.pegRatio as number | null,
          priceToBook: q.priceToBook as number | null,
          priceToSales: (q.priceToSalesTrailing12Months ?? null) as number | null,
          evToRevenue: (q.enterpriseToRevenue ?? null) as number | null,
          evToEbitda: (q.enterpriseToEbitda ?? null) as number | null,
          revenue: (q.totalRevenue ?? null) as number | null,
          revenueGrowth: (q.revenueGrowth ?? null) as number | null,
          grossMargin: (q.grossMargins ?? null) as number | null,
          ebitdaMargin: (q.ebitdaMargins ?? null) as number | null,
          operatingMargin: (q.operatingMargins ?? null) as number | null,
          profitMargin: (q.profitMargins ?? null) as number | null,
          returnOnEquity: (q.returnOnEquity ?? null) as number | null,
          returnOnAssets: (q.returnOnAssets ?? null) as number | null,
          debtToEquity: (q.debtToEquity ?? null) as number | null,
          currentRatio: (q.currentRatio ?? null) as number | null,
          dividendYield: (q.dividendYield ?? null) as number | null,
          payoutRatio: (q.payoutRatio ?? null) as number | null,
          beta: (q.beta ?? null) as number | null,
          shortRatio: (q.shortRatio ?? null) as number | null,
          fiftyTwoWeekHigh: (q.fiftyTwoWeekHigh ?? null) as number | null,
          fiftyTwoWeekLow: (q.fiftyTwoWeekLow ?? null) as number | null,
          averageVolume: (q.averageVolume ?? null) as number | null,
          totalCash: (q.totalCash ?? null) as number | null,
          totalDebt: (q.totalDebt ?? null) as number | null,
          freeCashflow: (q.freeCashflow ?? null) as number | null,
          operatingCashflow: (q.operatingCashflow ?? null) as number | null,
        }))
        setData(items)
        setDetail(items.find(i => i.symbol === selected) ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
setDetail(data.find(i => i.symbol === selected) ?? null)
  }, [selected, data])

  const fmt = (n: number | null, decimals = 2) => n != null ? n.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—'
  const fmtB = (n: number | null) => {
    if (n == null) return '—'
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${n.toLocaleString()}`
  }
  const pct = (n: number | null) => n != null ? `${(n * 100).toFixed(1)}%` : '—'

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">COMPANY FUNDAMENTALS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {data.length} companies across US, IDX, EU, Asia
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Symbol Selector */}
        <div className="flex flex-wrap gap-2">
          {WATCHLIST.map(sym => (
            <button key={sym} onClick={() => setSelected(sym)}
              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected === sym
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {sym}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading fundamentals...</div>
        ) : detail ? (
          <div className="grid grid-cols-12 gap-4">
            {/* Header */}
            <div className="col-span-12 bg-bg-panel border border-border-dim rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold font-mono text-text-primary">{detail.symbol}</h2>
                  <p className="text-sm text-text-dim">{detail.name}</p>
                  <p className="text-[10px] text-text-muted font-mono">{detail.sector} · {detail.industry}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-text-muted font-mono">Market Cap</p>
                  <p className="text-xl font-bold font-mono text-text-primary">{fmtB(detail.marketCap)}</p>
                  <p className="text-[10px] text-text-muted font-mono">EV: {fmtB(detail.enterpriseValue)}</p>
                </div>
              </div>
            </div>

            {/* Valuation Metrics */}
            <div className="col-span-4 bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">VALUATION</h3>
              <div className="space-y-2">
                {[
                  ['Trailing P/E', fmt(detail.trailingPE, 1)],
                  ['Forward P/E', fmt(detail.forwardPE, 1)],
                  ['PEG Ratio', fmt(detail.pegRatio, 2)],
                  ['P/B Ratio', fmt(detail.priceToBook, 2)],
                  ['P/S Ratio', fmt(detail.priceToSales, 2)],
                  ['EV/Revenue', fmt(detail.evToRevenue, 2)],
                  ['EV/EBITDA', fmt(detail.evToEbitda, 2)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-text-muted font-mono">{label}</span>
                    <span className="font-mono text-text-primary">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Profitability */}
            <div className="col-span-4 bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">PROFITABILITY</h3>
              <div className="space-y-2">
                {[
                  ['Revenue', fmtB(detail.revenue)],
                  ['Revenue Growth', pct(detail.revenueGrowth)],
                  ['Gross Margin', pct(detail.grossMargin)],
                  ['EBITDA Margin', pct(detail.ebitdaMargin)],
                  ['Operating Margin', pct(detail.operatingMargin)],
                  ['Profit Margin', pct(detail.profitMargin)],
                  ['ROE', pct(detail.returnOnEquity)],
                  ['ROA', pct(detail.returnOnAssets)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-text-muted font-mono">{label}</span>
                    <span className="font-mono text-text-primary">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Health */}
            <div className="col-span-4 bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">FINANCIAL HEALTH</h3>
              <div className="space-y-2">
                {[
                  ['Total Cash', fmtB(detail.totalCash)],
                  ['Total Debt', fmtB(detail.totalDebt)],
                  ['Debt/Equity', fmt(detail.debtToEquity, 1)],
                  ['Current Ratio', fmt(detail.currentRatio, 2)],
                  ['Free Cash Flow', fmtB(detail.freeCashflow)],
                  ['Operating CF', fmtB(detail.operatingCashflow)],
                  ['Dividend Yield', pct(detail.dividendYield)],
                  ['Payout Ratio', pct(detail.payoutRatio)],
                  ['Beta', fmt(detail.beta, 2)],
                  ['52W High', fmt(detail.fiftyTwoWeekHigh)],
                  ['52W Low', fmt(detail.fiftyTwoWeekLow)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-text-muted font-mono">{label}</span>
                    <span className="font-mono text-text-primary">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-text-dim text-xs p-8 text-center">Select a company above</div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            Yahoo Finance — 30+ fundamental metrics per company. Free, no API key.
            Covers US, IDX (.JK), EU, Asia exchanges.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
