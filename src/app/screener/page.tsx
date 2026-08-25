"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface StockData {
  symbol: string
  name: string
  sector: string
  marketCap: number
  price: number
  change: number
  changePercent: number
  pe: number | null
  dividend: number | null
  volume: number
  exchange: string
}

import { SCREENER_STOCKS } from '@/lib/config/universe'

const SECTORS = [...new Set(SCREENER_STOCKS.map(s => s.sector))].sort()
const EXCHANGES = [...new Set(SCREENER_STOCKS.map(s => s.exchange))].sort()

export default function ScreenerPage() {
  const [data, setData] = useState<Record<string, StockData>>({})
  const [loading, setLoading] = useState(true)
  const [sector, setSector] = useState('All')
  const [exchange, setExchange] = useState('All')
  const [sortField, setSortField] = useState<keyof StockData>('marketCap')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const symbols = SCREENER_STOCKS.map(s => s.symbol).join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, StockData> = {}
        for (const q of d.data ?? []) {
          const meta = SCREENER_STOCKS.find(s => s.symbol === q.symbol)
          map[q.symbol] = {
            symbol: q.symbol,
            name: q.shortName ?? meta?.name ?? q.symbol,
            sector: meta?.sector ?? 'Unknown',
            marketCap: q.marketCap ?? 0,
            price: q.regularMarketPrice ?? 0,
            change: q.regularMarketChange ?? 0,
            changePercent: q.regularMarketChangePercent ?? 0,
            pe: q.trailingPE ?? null,
            dividend: q.dividendYield ?? null,
            volume: q.regularMarketVolume ?? 0,
            exchange: meta?.exchange ?? 'Unknown',
          }
        }
        setData(map)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let stocks = Object.values(data)

    if (sector !== 'All') stocks = stocks.filter(s => s.sector === sector)
    if (exchange !== 'All') stocks = stocks.filter(s => s.exchange === exchange)
    if (search) {
      const q = search.toLowerCase()
      stocks = stocks.filter(s =>
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q)
      )
    }

    stocks.sort((a, b) => {
      const av = a[sortField] ?? 0
      const bv = b[sortField] ?? 0
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })

    return stocks
  }, [data, sector, exchange, sortField, sortDir, search])

  const handleSort = (field: keyof StockData) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const fmt = (n: number | null, decimals = 2) => n != null ? n.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—'
  const fmtMcap = (n: number) => {
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${n.toLocaleString()}`
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">MULTI-ASSET SCREENER</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {Object.keys(data).length} stocks across {EXCHANGES.length} exchanges
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search symbol, name, sector..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs font-mono bg-bg-panel border border-border-dim rounded text-text-primary placeholder:text-text-muted w-64"
          />
          <select value={sector} onChange={e => setSector(e.target.value)}
            className="px-2 py-1.5 text-xs font-mono bg-bg-panel border border-border-dim rounded text-text-primary">
            <option value="All">All Sectors</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={exchange} onChange={e => setExchange(e.target.value)}
            className="px-2 py-1.5 text-xs font-mono bg-bg-panel border border-border-dim rounded text-text-primary">
            <option value="All">All Exchanges</option>
            {EXCHANGES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <span className="text-[10px] text-text-muted font-mono">{filtered.length} results</span>
        </div>

        {/* Results Table */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading screener data...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  {([
                    ['symbol', 'SYMBOL'],
                    ['name', 'NAME'],
                    ['exchange', 'EXCH'],
                    ['sector', 'SECTOR'],
                    ['price', 'PRICE'],
                    ['changePercent', 'CHG%'],
                    ['marketCap', 'MKT CAP'],
                    ['pe', 'P/E'],
                    ['dividend', 'DIV%'],
                    ['volume', 'VOLUME'],
                  ] as [keyof StockData, string][]).map(([field, label]) => (
                    <th key={field}
                      className={`py-2 font-mono cursor-pointer hover:text-text-primary ${field === 'symbol' || field === 'name' ? 'text-left' : 'text-right'}`}
                      onClick={() => handleSort(field)}>
                      {label} {sortField === field ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                    <td className="py-2 font-mono text-accent-cyan">{s.symbol}</td>
                    <td className="py-2 text-text-dim max-w-40 truncate">{s.name}</td>
                    <td className="py-2 text-right font-mono text-text-muted">{s.exchange}</td>
                    <td className="py-2 text-right font-mono text-text-muted">{s.sector}</td>
                    <td className="py-2 text-right font-mono">{fmt(s.price)}</td>
                    <td className={`py-2 text-right font-mono font-bold ${s.changePercent >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {s.changePercent >= 0 ? '+' : ''}{fmt(s.changePercent)}%
                    </td>
                    <td className="py-2 text-right font-mono">{fmtMcap(s.marketCap)}</td>
                    <td className="py-2 text-right font-mono">{fmt(s.pe, 1)}</td>
                    <td className="py-2 text-right font-mono">{s.dividend != null ? `${fmt(s.dividend)}%` : '—'}</td>
                    <td className="py-2 text-right font-mono">{s.volume.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
