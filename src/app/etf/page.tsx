"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface ETFData {
  symbol: string
  name: string
  category: string
  expenseRatio: number | null
  aum: number | null
  price: number
  change: number
  changePercent: number
  volume: number
  yield: number | null
  ytdReturn: number | null
  oneYearReturn: number | null
  threeYearReturn: number | null
  fiveYearReturn: number | null
  beta: number | null
  pe: number | null
  holdings: number | null
}

const ETF_LIST = [
  // US Broad Market
  { symbol: 'SPY', name: 'SPDR S&P 500', category: 'US Broad' },
  { symbol: 'QQQ', name: 'Invesco QQQ', category: 'US Growth' },
  { symbol: 'IWM', name: 'iShares Russell 2000', category: 'US Small Cap' },
  { symbol: 'DIA', name: 'SPDR Dow Jones', category: 'US Value' },
  { symbol: 'VTI', name: 'Vanguard Total Market', category: 'US Total' },
  // Sector
  { symbol: 'XLK', name: 'Technology Select', category: 'Sector' },
  { symbol: 'XLF', name: 'Financial Select', category: 'Sector' },
  { symbol: 'XLE', name: 'Energy Select', category: 'Sector' },
  { symbol: 'XLV', name: 'Health Care Select', category: 'Sector' },
  { symbol: 'XLI', name: 'Industrial Select', category: 'Sector' },
  // International
  { symbol: 'EFA', name: 'iShares MSCI EAFE', category: 'Intl Developed' },
  { symbol: 'EEM', name: 'iShares MSCI Emerging', category: 'EM' },
  { symbol: 'VWO', name: 'Vanguard Emerging', category: 'EM' },
  // Fixed Income
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury', category: 'Bond' },
  { symbol: 'IEF', name: 'iShares 7-10 Year Treasury', category: 'Bond' },
  { symbol: 'SHY', name: 'iShares 1-3 Year Treasury', category: 'Bond' },
  { symbol: 'LQD', name: 'iShares IG Corporate', category: 'Bond' },
  { symbol: 'HYG', name: 'iShares High Yield', category: 'Bond' },
  // Commodities
  { symbol: 'GLD', name: 'SPDR Gold', category: 'Commodity' },
  { symbol: 'SLV', name: 'iShares Silver', category: 'Commodity' },
  { symbol: 'USO', name: 'US Oil Fund', category: 'Commodity' },
  // Thematic
  { symbol: 'ARKK', name: 'ARK Innovation', category: 'Thematic' },
  { symbol: 'ICLN', name: 'iShares Global Clean', category: 'Thematic' },
  { symbol: 'BOTZ', name: 'Global X Robotics', category: 'Thematic' },
]

export default function ETFPage() {
  const [data, setData] = useState<Record<string, ETFData>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')

  const categories = ['All', ...new Set(ETF_LIST.map(e => e.category))].sort()

  useEffect(() => {
    const symbols = ETF_LIST.map(e => e.symbol).join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, ETFData> = {}
        for (const q of d.data ?? []) {
          const meta = ETF_LIST.find(e => e.symbol === q.symbol)
          map[q.symbol] = {
            symbol: q.symbol,
            name: q.shortName ?? meta?.name ?? q.symbol,
            category: meta?.category ?? 'Unknown',
            expenseRatio: q.annualHoldingsTurnover ?? null,
            aum: q.totalAssets ?? null,
            price: q.regularMarketPrice ?? 0,
            change: q.regularMarketChange ?? 0,
            changePercent: q.regularMarketChangePercent ?? 0,
            volume: q.regularMarketVolume ?? 0,
            yield: q.dividendYield ?? null,
            ytdReturn: null,
            oneYearReturn: null,
            threeYearReturn: null,
            fiveYearReturn: null,
            beta: q.beta ?? null,
            pe: q.trailingPE ?? null,
            holdings: null,
          }
        }
        setData(map)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = filter === 'All' ? ETF_LIST : ETF_LIST.filter(e => e.category === filter)

  const fmt = (n: number | null, decimals = 2) => n != null ? n.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—'
  const fmtB = (n: number | null) => {
    if (n == null) return '—'
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${fmt(n)}`
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">ETF ANALYTICS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {ETF_LIST.length} ETFs across {categories.length - 1} categories
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button key={cat} onClick={() => setFilter(cat)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                filter === cat
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {cat}
            </button>
          ))}
        </div>

        {/* ETF Table */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading ETF data...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <th className="text-left py-2 font-mono">SYMBOL</th>
                  <th className="text-left py-2 font-mono">NAME</th>
                  <th className="text-left py-2 font-mono">CATEGORY</th>
                  <th className="text-right py-2 font-mono">PRICE</th>
                  <th className="text-right py-2 font-mono">CHG%</th>
                  <th className="text-right py-2 font-mono">AUM</th>
                  <th className="text-right py-2 font-mono">YIELD</th>
                  <th className="text-right py-2 font-mono">VOLUME</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(etf => {
                  const d = data[etf.symbol]
                  if (!d) return null
                  return (
                    <tr key={etf.symbol}
                      className={`border-b border-border-dim/30 hover:bg-bg-elevated cursor-pointer ${selected === etf.symbol ? 'bg-bg-elevated' : ''}`}
                      onClick={() => setSelected(selected === etf.symbol ? null : etf.symbol)}>
                      <td className="py-2 font-mono text-accent-cyan">{d.symbol}</td>
                      <td className="py-2 text-text-dim max-w-40 truncate">{d.name}</td>
                      <td className="py-2 text-text-muted">{d.category}</td>
                      <td className="py-2 text-right font-mono">${fmt(d.price)}</td>
                      <td className={`py-2 text-right font-mono font-bold ${d.changePercent >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                        {d.changePercent >= 0 ? '+' : ''}{fmt(d.changePercent)}%
                      </td>
                      <td className="py-2 text-right font-mono">{fmtB(d.aum)}</td>
                      <td className="py-2 text-right font-mono">{d.yield != null ? `${(d.yield * 100).toFixed(2)}%` : '—'}</td>
                      <td className="py-2 text-right font-mono">{d.volume.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Detail Panel */}
        {selected && data[selected] && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">{selected} — {data[selected].name}</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] text-text-muted font-mono">Price</p>
                <p className="text-lg font-bold font-mono text-text-primary">${fmt(data[selected].price)}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted font-mono">Change</p>
                <p className={`text-lg font-bold font-mono ${data[selected].changePercent >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                  {data[selected].changePercent >= 0 ? '+' : ''}{fmt(data[selected].changePercent)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted font-mono">AUM</p>
                <p className="text-lg font-bold font-mono text-text-primary">{fmtB(data[selected].aum)}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted font-mono">Yield</p>
                <p className="text-lg font-bold font-mono text-text-primary">{data[selected].yield != null ? `${(data[selected].yield! * 100).toFixed(2)}%` : '—'}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            Yahoo Finance — 24 ETFs across US Broad, Sector, International, Fixed Income, Commodities, Thematic.
            AUM, yield, and volume are real-time. Holdings data requires ETF provider API integration.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
