"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

// Type alias (not interface): useTableControls requires Record<string, unknown>,
// which TS only satisfies implicitly for type aliases.
type ETFFlow = {
  issuer: string
  asset: string
  netFlowUsd: number
  cumulativeFlowUsd: number
  date: string
}

interface ETFSummary {
  totalFlow: number
  cumulativeFlow: number
  positiveDays: number
  negativeDays: number
  dayCount: number
  trend: string
  avgDailyFlow: number
}

interface PremiumSnapshot {
  venuePair: string
  asset: string
  premiumPct: number
  description: string
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export default function ETFFlowsPage() {
  const [flows, setFlows] = useState<ETFFlow[]>([])
  const [summary, setSummary] = useState<ETFSummary | null>(null)
  const [premiums, setPremiums] = useState<PremiumSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/etf-flows?action=all')
        const d = await res.json()
        if (d.data?.etf) {
          setFlows(d.data.etf.flows ?? [])
          setSummary(d.data.etf.summary ?? null)
        }
        if (d.data?.premiums) setPremiums(d.data.premiums)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 300_000)
    return () => clearInterval(interval)
  }, [])

  // Display cap preserved: the table shows at most the 20 most recent days, as before.
  const rows = flows.slice(0, 20)
  const tc = useTableControls(rows)

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">ETF FLOWS + PREMIUMS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Institutional demand signals — spot BTC/ETH ETF flows, Coinbase Premium, Korea Premium, futures basis
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Summary Strip */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">30D NET FLOW</p>
              <p className={`text-lg font-mono font-bold ${summary.totalFlow >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>{fmtUsd(summary.totalFlow)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">CUMULATIVE</p>
              <p className="text-lg font-mono font-bold">{fmtUsd(summary.cumulativeFlow)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">POSITIVE DAYS</p>
              <p className="text-lg font-mono font-bold text-data-bull">{summary.positiveDays}/{summary.dayCount}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">TREND</p>
              <p className={`text-lg font-mono font-bold ${summary.trend === 'inflow' ? 'text-data-bull' : summary.trend === 'outflow' ? 'text-data-bear' : 'text-text-muted'}`}>{summary.trend}</p>
            </div>
          </div>
        )}

        {/* Premiums Strip */}
        {premiums.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {premiums.map((p, i) => (
              <div key={i} className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-[10px] text-text-muted font-mono">{p.venuePair}</p>
                <p className={`text-lg font-mono font-bold ${p.premiumPct >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                  {p.premiumPct >= 0 ? '+' : ''}{p.premiumPct.toFixed(3)}%
                </p>
                <p className="text-[9px] text-text-dim mt-0.5">{p.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Flow Table */}
        <Panel title="ETF Flows" subtitle={`${flows.length} days of data`}>
          {loading ? (
            <div className="text-text-dim text-xs p-4 text-center">Loading ETF flow data...</div>
          ) : (
            <>
              <TableControlsBar idPrefix="etf-flows" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
              {tc.visible.length === 0 ? (
                <div className="text-text-dim text-xs p-4 text-center">No flow data available</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-text-muted border-b border-border-dim">
                        <SortableTh controls={tc} k="date" className="text-left py-2 px-2 font-mono">DATE</SortableTh>
                        <SortableTh controls={tc} k="netFlowUsd" className="text-right py-2 px-2 font-mono">NET FLOW</SortableTh>
                        <SortableTh controls={tc} k="cumulativeFlowUsd" className="text-right py-2 px-2 font-mono">CUMULATIVE</SortableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {tc.visible.map(f => (
                        <tr key={f.date} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                          <td className="py-2 px-2 font-mono">{f.date}</td>
                          <td className={`py-2 px-2 text-right font-mono font-bold ${f.netFlowUsd >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                            {fmtUsd(f.netFlowUsd)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono">{fmtUsd(f.cumulativeFlowUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Panel>

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <p className="text-[9px] text-text-dim font-mono">
            Sources: Public ETF holdings disclosures, Coinbase/Binance/Upbit APIs.
            ETF flows are the best public proxy for institutional crypto demand.
            Premium data updated every 5 minutes.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
