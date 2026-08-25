"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

type CompData = {
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

import { PEER_GROUPS, PEER_GROUP_NAMES } from '@/lib/config/universe'

export default function ComparablesPage() {
  const [selected, setSelected] = useState('us-tech')
  const [symbols, setSymbols] = useState<string[]>(PEER_GROUPS['us-tech'].symbols)
  const [data, setData] = useState<Record<string, CompData>>({})
  const [loading, setLoading] = useState(true)

  // Membership: curated groups resolve from config; IDX groups are derived
  // server-side from the live universe (sector/industry predicates).
  useEffect(() => {
    let cancelled = false
    if (PEER_GROUPS[selected]) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- curated groups are local constants
      setSymbols(PEER_GROUPS[selected].symbols)
      return
    }
    fetch(`/api/v1/equities/universe?group=${selected}`)
      .then(r => r.json())
      .then(d => {
        const g = d.data?.group as { symbols?: string[] } | undefined
        if (!cancelled) setSymbols(g?.symbols ?? [])
      })
      .catch(() => { if (!cancelled) setSymbols([]) })
    return () => { cancelled = true }
  }, [selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true)
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols.join(',')}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, CompData> = {}
        for (const q of d.data ?? []) {
          if (!symbols.includes(q.symbol)) continue
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
  }, [symbols])

  const rows = useMemo(() => Object.values(data), [data])
  const tc = useTableControls(rows, undefined, { initialSortKey: 'marketCap', initialSortDir: 'desc' })

  // Compute averages for valuation metrics
  const averages = useMemo(() => {
    const vals = Object.values(data)
    const avg = (key: keyof CompData) => {
      const filtered = vals.filter(v => v[key] != null).map(v => v[key] as number)
      return filtered.length > 0 ? filtered.reduce((s, v) => s + v, 0) / filtered.length : null
    }
    return { pe: avg('pe'), pb: avg('pb'), ps: avg('ps'), evEbitda: avg('evEbitda'), roe: avg('roe'), margin: avg('margin') }
  }, [data])

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
              {Object.keys(PEER_GROUP_NAMES).length} peer groups · IDX membership derived live from universe
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Peer Group Selector */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(PEER_GROUP_NAMES).map(([key, gname]) => (
            <button key={key} onClick={() => setSelected(key)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected === key
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {gname}
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
          <>
            <TableControlsBar idPrefix="comps" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
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
                    <SortableTh key={field} controls={tc} k={field}
                      className={`py-2 font-mono ${field === 'symbol' || field === 'name' ? 'text-left' : 'text-right'}`}>
                      {label}
                    </SortableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tc.visible.map(comp => (
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
          </>
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
