"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

type BasisRow = {
  symbol: string
  spotPrice: number
  perpPrice: number
  basis: number
  basisPercent: number
  fundingRate: number
  annualizedFunding: number
  openInterest: number
  volume24h: number
  signal: string
}

const BASIS_COLUMNS = [
  { key: 'symbol' },
  { key: 'spotPrice' },
  { key: 'perpPrice' },
  { key: 'basis' },
  // Legacy sort buttons ranked by |basis %| and |annualized funding| — semantics preserved via accessors.
  { key: 'basisPercent', accessor: (r: BasisRow) => Math.abs(r.basisPercent) },
  { key: 'fundingRate' },
  { key: 'annualizedFunding', accessor: (r: BasisRow) => Math.abs(r.annualizedFunding) },
  // OI cell renders notional value (openInterest x perp price) — sort on the displayed magnitude.
  { key: 'openInterest', accessor: (r: BasisRow) => r.openInterest * r.perpPrice },
  { key: 'signal' },
]

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

export default function BasisPage() {
  const [rows, setRows] = useState<BasisRow[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/basis')
      const d = await res.json()
      if (d.data?.rows) {
        setRows(d.data.rows)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
fetchData()
    const id = setInterval(fetchData, 15_000)
    return () => clearInterval(id)
  }, [fetchData])

  const tc = useTableControls(rows, BASIS_COLUMNS, { initialSortKey: 'basisPercent', initialSortDir: 'desc' })

  // Featured-cards ordering kept independent of the table's filter/sort state.
  const featured = [...rows]
    .sort((a, b) => Math.abs(b.basisPercent) - Math.abs(a.basisPercent))
    .filter(r => Math.abs(r.basisPercent) > 0.02 || Math.abs(r.annualizedFunding) > 5)
    .slice(0, 6)

  const positiveBasis = rows.filter(r => r.basisPercent > 0).length
  const negativeBasis = rows.filter(r => r.basisPercent < 0).length
  const avgBasis = rows.length > 0 ? rows.reduce((s, r) => s + r.basisPercent, 0) / rows.length : 0
  const avgFunding = rows.length > 0 ? rows.reduce((s, r) => s + r.annualizedFunding, 0) / rows.length : 0

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">⚡</span> Perp vs Spot Basis
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Funding rate arbitrage scanner. Shows basis (perp-spot spread) and annualized funding for 20 major pairs.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-5 gap-2">
          <KPI label="Pairs" value={String(rows.length)} />
          <KPI label="Positive Basis" value={String(positiveBasis)} color="text-data-bull" />
          <KPI label="Negative Basis" value={String(negativeBasis)} color="text-data-bear" />
          <KPI label="Avg Basis" value={`${avgBasis.toFixed(3)}%`} />
          <KPI label="Avg Annualized" value={`${avgFunding.toFixed(1)}%`} />
        </div>

        {/* Arbitrage Signals */}
        <Panel title="⚡ Funding Arbitrage Opportunities" subtitle="Pairs with significant basis or funding" liveStatus={status}>
          <div className="p-3 grid grid-cols-2 gap-3">
            {featured
              .filter(r => Math.abs(r.basisPercent) > 0.02 || Math.abs(r.annualizedFunding) > 5)
              .slice(0, 6)
              .map((r, i) => (
                <div key={i} className={`p-3 rounded border ${
                  r.basisPercent > 0 ? 'bg-data-bull/5 border-data-bull/30' : 'bg-data-bear/5 border-data-bear/30'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-mono font-bold text-text-primary">{r.symbol}</span>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      r.signal === 'Short Basis' ? 'bg-data-bear/20 text-data-bear' :
                      r.signal === 'Long Basis' ? 'bg-data-bull/20 text-data-bull' :
                      'bg-bg-raised text-text-muted'
                    }`}>
                      {r.signal}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] font-mono">
                    <span className="text-text-muted">Basis: <span className={`font-bold ${r.basisPercent > 0 ? 'text-data-bull' : 'text-data-bear'}`}>{r.basisPercent > 0 ? '+' : ''}{r.basisPercent.toFixed(4)}%</span></span>
                    <span className="text-text-muted">Funding: <span className={`font-bold ${r.fundingRate > 0 ? 'text-data-bear' : 'text-data-bull'}`}>{(r.fundingRate * 100).toFixed(4)}%</span></span>
                    <span className="text-text-muted">Ann: <span className="text-text-primary font-bold">{r.annualizedFunding.toFixed(1)}%</span></span>
                  </div>
                </div>
              ))}
          </div>
        </Panel>

        {/* Full Table */}
        <Panel title="All Pairs" subtitle={`${tc.total} USDT perpetual pairs`} liveStatus={status} onRefresh={fetchData}>
          <TableControlsBar idPrefix="basis" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
          <div className="overflow-auto scrollbar-thin">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-text-muted">
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">#</th>
                  <SortableTh controls={tc} k="symbol" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Pair</SortableTh>
                  <SortableTh controls={tc} k="spotPrice" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Spot</SortableTh>
                  <SortableTh controls={tc} k="perpPrice" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Perp</SortableTh>
                  <SortableTh controls={tc} k="basis" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Basis</SortableTh>
                  <SortableTh controls={tc} k="basisPercent" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Basis %</SortableTh>
                  <SortableTh controls={tc} k="fundingRate" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Funding</SortableTh>
                  <SortableTh controls={tc} k="annualizedFunding" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Ann%</SortableTh>
                  <SortableTh controls={tc} k="openInterest" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">OI</SortableTh>
                  <SortableTh controls={tc} k="signal" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Signal</SortableTh>
                </tr>
              </thead>
              <tbody>
                {tc.visible.map((r, i) => (
                  <tr key={r.symbol} className="border-b border-bg-border/30 hover:bg-bg-raised transition-colors">
                    <td className="text-[11px] font-mono px-3 py-1.5 text-text-muted">{i + 1}</td>
                    <td className="text-[12px] font-mono px-3 py-1.5 font-bold text-teal-vivid">{r.symbol}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-primary tabular-nums">${r.spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-primary tabular-nums">${r.perpPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className={`text-[11px] font-mono px-3 py-1.5 text-right font-bold tabular-nums ${r.basis > 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {r.basis > 0 ? '+' : ''}${r.basis.toFixed(2)}
                    </td>
                    <td className={`text-[11px] font-mono px-3 py-1.5 text-right font-bold tabular-nums ${r.basisPercent > 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {r.basisPercent > 0 ? '+' : ''}{r.basisPercent.toFixed(4)}%
                    </td>
                    <td className={`text-[11px] font-mono px-3 py-1.5 text-right font-bold tabular-nums ${r.fundingRate > 0 ? 'text-data-bear' : 'text-data-bull'}`}>
                      {(r.fundingRate * 100).toFixed(4)}%
                    </td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-primary tabular-nums">
                      {r.annualizedFunding.toFixed(1)}%
                    </td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-secondary tabular-nums">
                      {fmtUsd(r.openInterest * r.perpPrice)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        r.signal === 'Short Basis' ? 'bg-data-bear/20 text-data-bear' :
                        r.signal === 'Long Basis' ? 'bg-data-bull/20 text-data-bull' :
                        r.signal === 'Low Vol' ? 'bg-bg-raised text-text-muted' :
                        'bg-accent-amber/20 text-accent-amber'
                      }`}>
                        {r.signal}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}