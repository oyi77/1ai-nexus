"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface FinancialData {
  symbol: string
  name: string
  // Income Statement
  revenue: number | null
  revenueGrowth: number | null
  grossProfit: number | null
  grossMargin: number | null
  operatingIncome: number | null
  operatingMargin: number | null
  netIncome: number | null
  profitMargin: number | null
  ebitda: number | null
  ebitdaMargin: number | null
  eps: number | null
  // Balance Sheet
  totalAssets: number | null
  totalLiabilities: number | null
  totalEquity: number | null
  cash: number | null
  debt: number | null
  debtToEquity: number | null
  currentRatio: number | null
  bookValuePerShare: number | null
  // Cash Flow
  operatingCashFlow: number | null
  capitalExpenditure: number | null
  freeCashFlow: number | null
  fcfPerShare: number | null
  // Returns
  returnOnEquity: number | null
  returnOnAssets: number | null
  returnOnCapital: number | null
  // Per Share
  sharesOutstanding: number | null
  marketCap: number | null
  enterpriseValue: number | null
}

const SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ',
  'BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'TLKM.JK', 'GOTO.JK',
  'SAP.DE', 'MC.PA', '0700.HK', 'BABA', '7203.T',
]

export default function FinancialsPage() {
  const [selected, setSelected] = useState('AAPL')
  const [data, setData] = useState<FinancialData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${selected}`)
      .then(r => r.json())
      .then(d => {
        const q = d.data?.[0]
        if (!q) { setLoading(false); return }

        const marketCap = q.marketCap ?? 0
        const shares = q.sharesOutstanding ?? 1
        const price = q.regularMarketPrice ?? 0

        setData({
          symbol: q.symbol,
          name: q.shortName ?? q.longName ?? q.symbol,
          // Income Statement
          revenue: q.totalRevenue ?? null,
          revenueGrowth: q.revenueGrowth ?? null,
          grossProfit: q.grossProfits ?? null,
          grossMargin: q.grossMargins ?? null,
          operatingIncome: q.operatingIncome ?? null,
          operatingMargin: q.operatingMargins ?? null,
          netIncome: q.netIncomeToCommon ?? null,
          profitMargin: q.profitMargins ?? null,
          ebitda: q.ebitda ?? null,
          ebitdaMargin: q.ebitdaMargins ?? null,
          eps: q.trailingEps ?? null,
          // Balance Sheet
          totalAssets: q.totalAssets ?? null,
          totalLiabilities: null, // Not directly available
          totalEquity: q.bookValue != null ? q.bookValue * shares : null,
          cash: q.totalCash ?? null,
          debt: q.totalDebt ?? null,
          debtToEquity: q.debtToEquity ?? null,
          currentRatio: q.currentRatio ?? null,
          bookValuePerShare: q.bookValue ?? null,
          // Cash Flow
          operatingCashFlow: q.operatingCashflow ?? null,
          capitalExpenditure: null, // Not directly available
          freeCashFlow: q.freeCashflow ?? null,
          fcfPerShare: q.freeCashflow != null && shares > 0 ? q.freeCashflow / shares : null,
          // Returns
          returnOnEquity: q.returnOnEquity ?? null,
          returnOnAssets: q.returnOnAssets ?? null,
          returnOnCapital: null, // Not directly available
          // Per Share
          sharesOutstanding: shares,
          marketCap,
          enterpriseValue: q.enterpriseValue ?? null,
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [selected])

  const fmt = (n: number | null, decimals = 2) => n != null ? n.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—'
  const fmtB = (n: number | null) => {
    if (n == null) return '—'
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
    return `$${fmt(n)}`
  }
  const pct = (n: number | null) => n != null ? `${(n * 100).toFixed(1)}%` : '—'

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">FINANCIAL STATEMENTS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Income statement, balance sheet, cash flow — {SYMBOLS.length} companies
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Symbol Selector */}
        <div className="flex flex-wrap gap-2">
          {SYMBOLS.map(sym => (
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
          <div className="text-text-dim text-xs p-8 text-center">Loading financial data...</div>
        ) : data ? (
          <div className="grid grid-cols-12 gap-4">
            {/* Header */}
            <div className="col-span-12 bg-bg-panel border border-border-dim rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold font-mono text-text-primary">{data.symbol}</h2>
                  <p className="text-sm text-text-dim">{data.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-text-muted font-mono">Market Cap</p>
                  <p className="text-xl font-bold font-mono text-text-primary">{fmtB(data.marketCap)}</p>
                  <p className="text-[10px] text-text-muted font-mono">EV: {fmtB(data.enterpriseValue)}</p>
                </div>
              </div>
            </div>

            {/* Income Statement */}
            <div className="col-span-4 bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">INCOME STATEMENT</h3>
              <div className="space-y-2">
                {[
                  ['Revenue', fmtB(data.revenue)],
                  ['Revenue Growth', pct(data.revenueGrowth)],
                  ['Gross Profit', fmtB(data.grossProfit)],
                  ['Gross Margin', pct(data.grossMargin)],
                  ['Operating Income', fmtB(data.operatingIncome)],
                  ['Operating Margin', pct(data.operatingMargin)],
                  ['Net Income', fmtB(data.netIncome)],
                  ['Profit Margin', pct(data.profitMargin)],
                  ['EBITDA', fmtB(data.ebitda)],
                  ['EBITDA Margin', pct(data.ebitdaMargin)],
                  ['EPS', `$${fmt(data.eps)}`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-text-muted font-mono">{label}</span>
                    <span className="font-mono text-text-primary">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Balance Sheet */}
            <div className="col-span-4 bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">BALANCE SHEET</h3>
              <div className="space-y-2">
                {[
                  ['Total Assets', fmtB(data.totalAssets)],
                  ['Total Equity', fmtB(data.totalEquity)],
                  ['Cash', fmtB(data.cash)],
                  ['Total Debt', fmtB(data.debt)],
                  ['Debt/Equity', fmt(data.debtToEquity, 1)],
                  ['Current Ratio', fmt(data.currentRatio, 2)],
                  ['Book Value/Share', `$${fmt(data.bookValuePerShare)}`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-text-muted font-mono">{label}</span>
                    <span className="font-mono text-text-primary">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cash Flow + Returns */}
            <div className="col-span-4 bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">CASH FLOW & RETURNS</h3>
              <div className="space-y-2">
                {[
                  ['Operating CF', fmtB(data.operatingCashFlow)],
                  ['Free Cash Flow', fmtB(data.freeCashFlow)],
                  ['FCF/Share', `$${fmt(data.fcfPerShare)}`],
                  ['ROE', pct(data.returnOnEquity)],
                  ['ROA', pct(data.returnOnAssets)],
                  ['Shares Out', data.sharesOutstanding != null ? `${(data.sharesOutstanding / 1e9).toFixed(2)}B` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-text-muted font-mono">{label}</span>
                    <span className="font-mono text-text-primary">{value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-3 border-t border-border-dim">
                <h4 className="text-[10px] font-mono text-accent-cyan mb-2">KEY RATIOS</h4>
                <div className="space-y-2">
                  {[
                    ['P/E', data.eps != null && data.eps > 0 ? fmt((data.marketCap ?? 0) / (data.netIncome ?? 1), 1) : '—'],
                    ['P/B', data.bookValuePerShare != null && data.bookValuePerShare > 0 ? fmt((data.marketCap ?? 0) / ((data.bookValuePerShare ?? 1) * (data.sharesOutstanding ?? 1)), 1) : '—'],
                    ['P/S', data.revenue != null && data.revenue > 0 ? fmt((data.marketCap ?? 0) / data.revenue, 2) : '—'],
                    ['EV/EBITDA', data.ebitda != null && data.ebitda > 0 ? fmt((data.enterpriseValue ?? 0) / data.ebitda, 1) : '—'],
                    ['FCF Yield', data.freeCashFlow != null && data.marketCap != null && data.marketCap > 0 ? pct(data.freeCashFlow / data.marketCap) : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-text-muted font-mono">{label}</span>
                      <span className="font-mono text-text-primary">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-text-dim text-xs p-8 text-center">Select a company above</div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            Yahoo Finance — Income statement, balance sheet, cash flow, key ratios.
            Data is trailing twelve months (TTM). For historical financials (10+ years),
            SEC EDGAR integration is planned.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
