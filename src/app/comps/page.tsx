"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface CompData {
  symbol: string
  name: string
  sector: string
  marketCap: number
  price: number
  change: number
  pe: number | null
  pb: number | null
  ps: number | null
  evEbitda: number | null
  roe: number | null
  margin: number | null
  revenueGrowth: number | null
  dividendYield: number | null
  debtEquity: number | null
}

const PEER_GROUPS: Record<string, { name: string; symbols: string[] }> = {
  'us-banks': { name: 'US Banks', symbols: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C'] },
  'us-tech': { name: 'US Big Tech', symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA'] },
  'us-healthcare': { name: 'US Healthcare', symbols: ['UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK'] },
  'us-energy': { name: 'US Energy', symbols: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY'] },
  'idx-banks': { name: 'IDX Banks', symbols: ['BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'BBNI.JK', 'BRIS.JK', 'BTPS.JK'] },
  'idx-telecom': { name: 'IDX Telecom', symbols: ['TLKM.JK', 'EXCL.JK', 'ISAT.JK', 'FREN.JK'] },
  'global-luxury': { name: 'Global Luxury', symbols: ['MC.PA', 'RMS.DE', 'CFR.SW', 'EL', 'COTY', 'TPR'] },
  'ev-battery': { name: 'EV & Battery', symbols: ['TSLA', 'NIO', 'RIVN', 'LCID', 'BYDDY', '1211.HK'] },
}

export default function ComparablesPage() {
  const [selected, setSelected] = useState('us-tech')
  const [data, setData] = useState<Record<string, CompData>>({})
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<keyof CompData>('marketCap')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const group = PEER_GROUPS[selected]

  useEffect(() => {
    setLoading(true)
    const symbols = group.symbols.join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, CompData> = {}
        for (const q of d.data ?? []) {
          const meta = group.symbols.find(s => s === q.symbol)
          map[q.symbol] = {
            symbol: q.symbol,
            name: q.shortName ?? q.symbol,
            sector: q.sector ?? 'Unknown',
            marketCap: q.marketCap ?? 0,
            price: q.regularMarketPrice ?? 0,
            change: q.regularMarketChangePercent ?? 0,
            pe: q.trailingPE ?? null,
            pb: q.priceToBook ?? null,
            ps: q.priceToSalesTrailing12Months ?? null,
            evEbitda: q.enterpriseToEbitda ?? null,
            roe: q.returnOnEquity ?? null,
            margin: q.profitMargins ?? null,
            revenueGrowth: q.revenueGrowth ?? null,
            dividendYield: q.dividendYield ?? null,
            debtEquity: q.debtToEquity ?? null,
          }
        }
        setData(map)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [selected])

  const sorted = useMemo(() => {
    return Object.values(data).sort((a, b) => {
      const av = a[sortField] ?? 0
      const bv = b[sortField] ?? 0
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
  }, [data, sortField, sortDir])

  // Compute averages for valuation metrics
  const averages = useMemo(() => {
    const vals = Object.values(data)
    const avg = (key: keyof CompData) => {
      const filtered = vals.filter(v => v[key] != null).map(v => v[key] as number)
      return filtered.length > 0 ? filtered.reduce((s, v) => s + v, 0) / filtered.length : null
    }
    return { pe: avg('pe'), pb: avg('pb'), ps: avg('ps'), evEbitda: avg('evEbitda'), roe: avg('roe'), margin: avg('margin') }
  }, [data])

  const handleSort = (field: keyof CompData) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const fmt = (n: number | null, decimals = 2) => n != null ? n.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—'
  const fmtB = (n: number) => {
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${fmt(n)}`
  }
  const pct = (n: number | null) => n != null ? `${(n * 100).toFixed(1)}%` : '—'

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">COMPARABLE COMPANY ANALYSIS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {Object.keys(PEER_GROUPS).length} peer groups · {Object.values(PEER_GROUPS).reduce((s, g) => s + g.symbols.length, 0)} companies
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Peer Group Selector */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(PEER_GROUPS).map(([key, g]) => (
            <button key={key} onClick={() => setSelected(key)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected === key
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {g.name}
            </button>
          ))}
        </div>

        {/* Summary Averages */}
        {!loading && Object.keys(data).length > 0 && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">GROUP AVERAGES</h3>
            <div className="grid grid-cols-6 gap-4">
              {[
                ['Avg P/E', averages.pe != null ? fmt(averages.pe, 1) : '—'],
                ['Avg P/B', averages.pb != null ? fmt(averages.pb, 1) : '—'],
                ['Avg P/S', averages.ps != null ? fmt(averages.ps, 2) : '—'],
                ['Avg EV/EBITDA', averages.evEbitda != null ? fmt(averages.evEbitda, 1) : '—'],
                ['Avg ROE', averages.roe != null ? pct(averages.roe) : '—'],
                ['Avg Margin', averages.margin != null ? pct(averages.margin) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="text-center">
                  <p className="text-[10px] text-text-muted font-mono">{label}</p>
                  <p className="text-lg font-bold font-mono text-text-primary">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comparables Table */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading comparable data...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  {([
                    ['symbol', 'SYMBOL'],
                    ['name', 'NAME'],
                    ['marketCap', 'MKT CAP'],
                    ['price', 'PRICE'],
                    ['change', 'CHG%'],
                    ['pe', 'P/E'],
                    ['pb', 'P/B'],
                    ['ps', 'P/S'],
                    ['evEbitda', 'EV/EBITDA'],
                    ['roe', 'ROE'],
                    ['margin', 'MARGIN'],
                    ['revenueGrowth', 'REV GRW'],
                    ['dividendYield', 'DIV'],
                  ] as [keyof CompData, string][]).map(([field, label]) => (
                    <th key={field}
                      className={`py-2 font-mono cursor-pointer hover:text-text-primary ${field === 'symbol' || field === 'name' ? 'text-left' : 'text-right'}`}
                      onClick={() => handleSort(field)}>
                      {label} {sortField === field ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(comp => (
                  <tr key={comp.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                    <td className="py-2 font-mono text-accent-cyan">{comp.symbol}</td>
                    <td className="py-2 text-text-dim max-w-32 truncate">{comp.name}</td>
                    <td className="py-2 text-right font-mono">{fmtB(comp.marketCap)}</td>
                    <td className="py-2 text-right font-mono">${fmt(comp.price)}</td>
                    <td className={`py-2 text-right font-mono font-bold ${comp.change >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {comp.change >= 0 ? '+' : ''}{fmt(comp.change)}%
                    </td>
                    <td className="py-2 text-right font-mono">{fmt(comp.pe, 1)}</td>
                    <td className="py-2 text-right font-mono">{fmt(comp.pb, 1)}</td>
                    <td className="py-2 text-right font-mono">{fmt(comp.ps, 2)}</td>
                    <td className="py-2 text-right font-mono">{fmt(comp.evEbitda, 1)}</td>
                    <td className="py-2 text-right font-mono">{pct(comp.roe)}</td>
                    <td className="py-2 text-right font-mono">{pct(comp.margin)}</td>
                    <td className="py-2 text-right font-mono">{pct(comp.revenueGrowth)}</td>
                    <td className="py-2 text-right font-mono">{pct(comp.dividendYield)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">METHODOLOGY</h2>
          <p className="text-xs text-text-dim">
            Comparable Company Analysis (Comps) — the most widely used valuation method in investment banking.
            Compare valuation multiples (P/E, P/B, P/S, EV/EBITDA) across peer groups to identify
            relative value. Group averages help identify over/undervalued names.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
