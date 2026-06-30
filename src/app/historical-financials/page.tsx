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

// Companies with CIK numbers for SEC EDGAR
const COMPANIES = [
  { ticker: 'AAPL', name: 'Apple', cik: '0000320193' },
  { ticker: 'MSFT', name: 'Microsoft', cik: '0000789019' },
  { ticker: 'GOOGL', name: 'Alphabet', cik: '0001652044' },
  { ticker: 'AMZN', name: 'Amazon', cik: '0001018724' },
  { ticker: 'NVDA', name: 'NVIDIA', cik: '0001045810' },
  { ticker: 'META', name: 'Meta', cik: '0001326801' },
  { ticker: 'TSLA', name: 'Tesla', cik: '0001318605' },
  { ticker: 'JPM', name: 'JPMorgan', cik: '0000019617' },
  { ticker: 'V', name: 'Visa', cik: '0001403161' },
  { ticker: 'JNJ', name: 'J&J', cik: '0000200406' },
  { ticker: 'WMT', name: 'Walmart', cik: '0000104169' },
  { ticker: 'PG', name: 'P&G', cik: '0000080424' },
  { ticker: 'XOM', name: 'Exxon', cik: '0000034088' },
  { ticker: 'UNH', name: 'UnitedHealth', cik: '0000731766' },
  { ticker: 'HD', name: 'Home Depot', cik: '0000354950' },
  { ticker: 'DIS', name: 'Disney', cik: '0001001039' },
  { ticker: 'NFLX', name: 'Netflix', cik: '0001065280' },
  { ticker: 'BA', name: 'Boeing', cik: '0000012927' },
  { ticker: 'GS', name: 'Goldman', cik: '0000886982' },
  { ticker: 'BAC', name: 'BofA', cik: '0000070858' },
]

async function fetchEdgarFinancials(cik: string): Promise<FinancialData[]> {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { 'User-Agent': '1ai-nexus/1.0 (contact@1ai-nexus.com)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return []

  const data = await res.json() as Record<string, unknown>
  const facts = data.facts as Record<string, unknown>
  const gaap = facts['us-gaap'] as Record<string, unknown> | undefined
  if (!gaap) return []

  const extractAnnual = (field: unknown): Map<string, number> => {
    const map = new Map<string, number>()
    if (!field || typeof field !== 'object') return map
    const f = field as { units?: Record<string, Array<{ end: string; val: number; form: string }>> }
    if (!f.units) return map
    const usd = f.units.USD ?? []
    for (const item of usd) {
      if (item.form === '10-K') {
        const year = item.end.substring(0, 4)
        if (!map.has(year)) map.set(year, item.val)
      }
    }
    return map
  }

  const revenue = extractAnnual(gaap.Revenues)
  const netIncome = extractAnnual(gaap.NetIncomeLoss)
  const assets = extractAnnual(gaap.Assets)
  const liabilities = extractAnnual(gaap.Liabilities)
  const equity = extractAnnual(gaap.StockholdersEquity)
  const operatingCF = extractAnnual(gaap.OperatingCashFlow)
  const capex = extractAnnual(gaap.PaymentsToAcquirePropertyPlantAndEquipment)

  const years = new Set<string>()
  for (const map of [revenue, netIncome, assets, liabilities, equity, operatingCF, capex]) {
    for (const year of map.keys()) years.add(year)
  }

  const result: FinancialData[] = []
  for (const year of [...years].sort().reverse()) {
    const rev = revenue.get(year) ?? null
    const ocf = operatingCF.get(year) ?? null
    const cx = capex.get(year) ?? null
    result.push({
      period: year,
      revenue: rev,
      netIncome: netIncome.get(year) ?? null,
      totalAssets: assets.get(year) ?? null,
      totalLiabilities: liabilities.get(year) ?? null,
      totalEquity: equity.get(year) ?? null,
      operatingCashFlow: ocf,
      capitalExpenditure: cx,
      freeCashFlow: ocf != null && cx != null ? ocf - cx : null,
    })
  }

  return result
}

export default function HistoricalFinancialsPage() {
  const [selected, setSelected] = useState('AAPL')
  const [data, setData] = useState<FinancialData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const company = COMPANIES.find(c => c.ticker === selected)
    if (!company) { setLoading(false); return }

    fetchEdgarFinancials(company.cik)
      .then(result => {
        setData(result)
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
                selected === c.ticker
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {c.ticker}
            </button>
          ))}
        </div>

        {/* Data Table */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading SEC EDGAR data for {selected}...</div>
        ) : data.length === 0 ? (
          <div className="text-text-dim text-xs p-8 text-center">No data available for {selected}</div>
        ) : (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h2 className="text-xs font-mono text-accent-cyan mb-3">
              {selected} — ANNUAL FINANCIALS (SEC 10-K FILINGS)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 font-mono">YEAR</th>
                    <th className="text-right py-2 font-mono">REVENUE</th>
                    <th className="text-right py-2 font-mono">REV GROWTH</th>
                    <th className="text-right py-2 font-mono">NET INCOME</th>
                    <th className="text-right py-2 font-mono">TOTAL ASSETS</th>
                    <th className="text-right py-2 font-mono">TOTAL EQUITY</th>
                    <th className="text-right py-2 font-mono">OPER CF</th>
                    <th className="text-right py-2 font-mono">CAPEX</th>
                    <th className="text-right py-2 font-mono">FCF</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 15).map((row, i) => {
                    const prevRev = i < data.length - 1 ? data[i + 1].revenue : null
                    const revGrowth = calcGrowth(row.revenue, prevRev)

                    return (
                      <tr key={row.period} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 font-mono text-accent-cyan font-bold">{row.period}</td>
                        <td className="py-2 text-right font-mono">{fmtB(row.revenue)}</td>
                        <td className={`py-2 text-right font-mono ${revGrowth != null && revGrowth >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {revGrowth != null ? `${revGrowth >= 0 ? '+' : ''}${revGrowth.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 text-right font-mono">{fmtB(row.netIncome)}</td>
                        <td className="py-2 text-right font-mono">{fmtB(row.totalAssets)}</td>
                        <td className="py-2 text-right font-mono">{fmtB(row.totalEquity)}</td>
                        <td className="py-2 text-right font-mono">{fmtB(row.operatingCashFlow)}</td>
                        <td className="py-2 text-right font-mono">{fmtB(row.capitalExpenditure)}</td>
                        <td className="py-2 text-right font-mono font-bold">{fmtB(row.freeCashFlow)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            SEC EDGAR XBRL API (data.sec.gov) — free, no API key required.
            Structured financial data from 10-K annual filings.
            User-Agent required per SEC policy.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
