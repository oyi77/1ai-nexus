"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Layers } from "lucide-react"
import { useTableControls, TableControlsBar, SortableTh } from "@/components/shell/TableControls"

type Protocol = {
  name: string
  chain: string
  tvl: number
  change_1d: unknown
  change_7d: unknown
  category: string
}

export default function DeFiTvlPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([])
  const [totalTvl, setTotalTvl] = useState(0)
  const [loading, setLoading] = useState(true)
  const [chain, setChain] = useState<string>('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (chain) params.set('chain', chain)
      const res = await fetch(`/api/v1/defi/tvl?${params}`)
      const data = await res.json()
      setProtocols(data.data?.protocols ?? data.protocols ?? [])
      setTotalTvl(data.data?.totalTvl ?? data.totalTvl ?? 0)
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [chain])

  useEffect(() => { const invoke = () => fetchData(); invoke() }, [fetchData])

  const tc = useTableControls(protocols)

  return (
    <NexusLayout>
      <div className="h-full overflow-auto">
        <div className="sticky top-0 bg-bg-panel z-10 px-4 py-3 border-b border-bg-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-bold text-teal-vivid flex items-center gap-2">
                <Layers size={14} /> DeFi TVL DASHBOARD
              </h1>
              <span className="text-xs text-text-muted">Total: <span className="text-data-bull font-mono">${formatTvl(totalTvl)}</span></span>
            </div>
            <div className="flex gap-1">
              {['', 'Ethereum', 'Solana', 'BSC', 'Arbitrum', 'Base'].map(c => (
                <button
                  key={c}
                  onClick={() => setChain(c)}
                  className={`px-2 py-0.5 rounded text-xs border font-mono transition-colors ${
                    chain === c ? 'bg-teal-dim/40 border-teal-dim text-text-primary' : 'bg-bg-panel border-bg-border text-text-muted'
                  }`}
                >
                  {c || 'ALL'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-2">
          {loading ? (
            <div className="text-center py-20 text-text-muted text-xs">Loading DeFi data from DeFiLlama...</div>
          ) : (
          <>
            <TableControlsBar idPrefix="defi-tvl" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-xs uppercase">
                  <th className="text-left py-2 px-2">#</th>
                  <SortableTh controls={tc} k="name" className="text-left py-2 px-2 font-mono">PROTOCOL</SortableTh>
                  <SortableTh controls={tc} k="chain" className="text-left py-2 px-2 font-mono">CHAIN</SortableTh>
                  <SortableTh controls={tc} k="category" className="text-left py-2 px-2 font-mono">CATEGORY</SortableTh>
                  <SortableTh controls={tc} k="tvl" className="text-right py-2 px-2 font-mono">TVL</SortableTh>
                  <SortableTh controls={tc} k="change_1d" className="text-right py-2 px-2 font-mono">1D</SortableTh>
                  <SortableTh controls={tc} k="change_7d" className="text-right py-2 px-2 font-mono">7D</SortableTh>
                </tr>
              </thead>
              <tbody>
                {tc.visible.map((p, i) => (
                  <tr key={p.name + i} className="border-t border-bg-border/30 hover:bg-bg-elevated cursor-pointer">
                    <td className="py-2 px-2 text-text-muted">{i + 1}</td>
                    <td className="py-2 px-2 font-mono text-text-primary">{p.name}</td>
                    <td className="py-2 px-2 text-teal-vivid">{p.chain}</td>
                    <td className="py-2 px-2 text-text-muted">{p.category}</td>
                    <td className="py-2 px-2 text-right font-mono text-data-bull">${formatTvl(Number(p.tvl))}</td>
                    <td className={`py-2 px-2 text-right font-mono ${Number(p.change_1d) >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {formatChange(p.change_1d)}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${Number(p.change_7d) >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {formatChange(p.change_7d)}
                    </td>
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
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toFixed(0)
}

function formatChange(v: unknown): string {
  const n = Number(v)
  if (isNaN(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
