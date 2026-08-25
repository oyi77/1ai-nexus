"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { TableControlsBar, SortableTh, useTableControls, type TableControlsColumn } from '@/components/shell/TableControls'

type ProtocolRevenue = {
  name: string
  category: string
  fees24h: number
  fees7d: number
  fees30d: number
  revenue24h: number
  revenue30d: number
  peRatio: number | null
  feeMargin: number | null
  change1d: number
  change7d: number
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function RevenuePageContent() {
  return <RevenuePageInner />
}

export default function RevenuePage() {
  return <NexusLayout><RevenuePageInner /></NexusLayout>
}

function RevenuePageInner() {
  const [protocols, setProtocols] = useState<ProtocolRevenue[]>([])
  const [totals, setTotals] = useState<{ totalFees24h: number; totalRevenue24h: number } | null>(null)
  const [categories, setCategories] = useState<Array<{ name: string; fees24h: number; count: number }>>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/revenue')
      const d = await res.json()
      if (d.data) {
        setProtocols(d.data.protocols ?? [])
        setTotals(d.data.totals ?? null)
        setCategories(d.data.categories ?? [])
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
    const id = setInterval(fetchData, 300_000)
    return () => clearInterval(id)
  }, [fetchData])

  const revColumns: TableControlsColumn<ProtocolRevenue>[] = [
    { key: 'peRatio', accessor: p => p.peRatio ?? -Infinity },
    { key: 'feeMargin', accessor: p => p.feeMargin ?? -Infinity },
  ]

  // Default paint: fees 24h desc — matches the panel subtitle's declared ordering.
  const revTc = useTableControls(protocols, revColumns, { initialSortKey: 'fees24h', initialSortDir: 'desc' })

  return (
    <>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-data-bull">💰</span> Protocol Revenue
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Token Terminal-style revenue metrics from DeFiLlama. Fees, revenue, P/E ratios for top protocols.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* KPI Strip */}
        {totals && (
          <div className="grid grid-cols-4 gap-2">
            <KPI label="Total Fees (24h)" value={fmtUsd(totals.totalFees24h)} />
            <KPI label="Total Revenue (24h)" value={fmtUsd(totals.totalRevenue24h)} />
            <KPI label="Top Protocols" value={String(protocols.length)} />
            <KPI label="Categories" value={String(categories.length)} />
          </div>
        )}

        {/* Top Protocols */}
        <Panel title="Top Protocols by Fees" subtitle={`${protocols.length} protocols | Sorted by 24h fees`} liveStatus={status} onRefresh={fetchData}>
          <TableControlsBar idPrefix="revenue" query={revTc.query} onQueryChange={revTc.setQuery} shown={revTc.visible.length} total={revTc.total} />
          <div className="overflow-auto scrollbar-thin">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-text-muted">
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">#</th>
                  <SortableTh controls={revTc} k="name" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Protocol</SortableTh>
                  <SortableTh controls={revTc} k="category" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Category</SortableTh>
                  <SortableTh controls={revTc} k="fees24h" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Fees 24h</SortableTh>
                  <SortableTh controls={revTc} k="fees30d" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Fees 30d</SortableTh>
                  <SortableTh controls={revTc} k="revenue24h" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Revenue 24h</SortableTh>
                  <SortableTh controls={revTc} k="peRatio" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">P/E Ratio</SortableTh>
                  <SortableTh controls={revTc} k="feeMargin" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Fee Margin</SortableTh>
                  <SortableTh controls={revTc} k="change1d" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">24h</SortableTh>
                </tr>
              </thead>
              <tbody>
                {revTc.visible.map((p, i) => (
                  <tr key={p.name} className="border-b border-bg-border/30 hover:bg-bg-raised transition-colors">
                    <td className="text-[11px] font-mono px-3 py-1.5 text-text-muted">{i + 1}</td>
                    <td className="text-[12px] font-mono px-3 py-1.5 font-bold text-text-primary">{p.name}</td>
                    <td className="text-[10px] font-mono px-3 py-1.5 text-text-muted">{p.category}</td>
                    <td className="text-[12px] font-mono px-3 py-1.5 text-right font-bold text-data-bull tabular-nums">{fmtUsd(p.fees24h)}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-secondary tabular-nums">{fmtUsd(p.fees30d)}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-teal-vivid tabular-nums">{fmtUsd(p.revenue24h)}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-primary tabular-nums">
                      {p.peRatio ? p.peRatio.toFixed(1) + 'x' : '—'}
                    </td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-primary tabular-nums">
                      {p.feeMargin ? (p.feeMargin * 100).toFixed(0) + '%' : '—'}
                    </td>
                    <td className={`text-[11px] font-mono px-3 py-1.5 text-right font-bold tabular-nums ${p.change1d >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {p.change1d > 0 ? '+' : ''}{p.change1d.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Category Breakdown */}
        <Panel title="Fee Revenue by Category" subtitle={`${categories.length} categories`} liveStatus={status}>
          <div className="p-3 grid grid-cols-5 gap-3">
            {categories.slice(0, 10).map((cat, i) => (
              <div key={i} className="bg-bg-raised p-3 rounded border border-bg-border">
                <div className="text-[10px] font-mono text-text-muted uppercase mb-1">{cat.name}</div>
                <div className="text-[14px] font-head font-bold text-text-primary tabular-nums">{fmtUsd(cat.fees24h)}</div>
                <div className="text-[9px] font-mono text-text-muted">{cat.count} protocols</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
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