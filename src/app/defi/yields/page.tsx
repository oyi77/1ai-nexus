"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Percent } from "lucide-react"
import { useTableControls, TableControlsBar, SortableTh } from "@/components/shell/TableControls"

type YieldPool = {
  pool: string
  chain: string
  project: string
  symbol: string
  tvlUsd: number
  apy: number
  apyBase: unknown
  apyReward: unknown
  stablecoin: boolean
}

export default function DeFiYieldsPage() {
  const [pools, setPools] = useState<YieldPool[]>([])
  const [loading, setLoading] = useState(true)
  const [stableOnly, setStableOnly] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '30' })
      if (stableOnly) params.set('stablecoin', 'true')
      const res = await fetch(`/api/v1/defi/yields?${params}`)
      const data = await res.json()
      setPools(data.data?.pools ?? data.pools ?? [])
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [stableOnly])

  useEffect(() => { const invoke = () => fetchData(); invoke() }, [fetchData])

  const tc = useTableControls(pools)

  return (
    <NexusLayout>
      <div className="h-full overflow-auto">
        <div className="sticky top-0 bg-bg-panel z-10 px-4 py-3 border-b border-bg-border">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-bold text-teal-vivid flex items-center gap-2">
              <Percent size={14} /> DeFi YIELD FINDER
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => setStableOnly(!stableOnly)}
                className={`px-2 py-0.5 rounded text-xs border font-mono transition-colors ${
                  stableOnly ? 'bg-data-bull/20 border-data-bull text-data-bull' : 'bg-bg-panel border-bg-border text-text-muted'
                }`}
              >
                STABLECOIN ONLY
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-2">
          {loading ? (
            <div className="text-center py-20 text-text-muted text-xs">Loading yield data from DeFiLlama...</div>
          ) : (
          <>
            <TableControlsBar idPrefix="defi-yields" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-xs uppercase">
                  <th className="text-left py-2 px-2">#</th>
                  <SortableTh controls={tc} k="project" className="text-left py-2 px-2 font-mono">PROTOCOL</SortableTh>
                  <SortableTh controls={tc} k="chain" className="text-left py-2 px-2 font-mono">CHAIN</SortableTh>
                  <SortableTh controls={tc} k="symbol" className="text-left py-2 px-2 font-mono">SYMBOL</SortableTh>
                  <SortableTh controls={tc} k="tvlUsd" className="text-right py-2 px-2 font-mono">TVL</SortableTh>
                  <SortableTh controls={tc} k="apy" className="text-right py-2 px-2 font-mono">APY</SortableTh>
                  <SortableTh controls={tc} k="apyBase" className="text-right py-2 px-2 font-mono">BASE</SortableTh>
                  <SortableTh controls={tc} k="apyReward" className="text-right py-2 px-2 font-mono">REWARD</SortableTh>
                </tr>
              </thead>
              <tbody>
                {tc.visible.map((p, i) => (
                  <tr key={p.pool + i} className="border-t border-bg-border/30 hover:bg-bg-elevated cursor-pointer">
                    <td className="py-2 px-2 text-text-muted">{i + 1}</td>
                    <td className="py-2 px-2 font-mono text-text-primary">{p.project}</td>
                    <td className="py-2 px-2 text-teal-vivid">{p.chain}</td>
                    <td className="py-2 px-2 text-text-muted">{p.symbol}</td>
                    <td className="py-2 px-2 text-right font-mono">${formatTvl(Number(p.tvlUsd))}</td>
                    <td className="py-2 px-2 text-right font-mono text-data-bull font-bold">{Number(p.apy).toFixed(2)}%</td>
                    <td className="py-2 px-2 text-right font-mono text-text-muted">{formatPct(p.apyBase)}</td>
                    <td className="py-2 px-2 text-right font-mono text-text-muted">{formatPct(p.apyReward)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}

function formatTvl(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toFixed(0)
}

function formatPct(v: unknown): string {
  const n = Number(v)
  return isNaN(n) ? '—' : `${n.toFixed(2)}%`
}
