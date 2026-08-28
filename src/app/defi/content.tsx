"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Layers, TrendingUp, TrendingDown } from "lucide-react"
import { useTableControls, TableControlsBar, SortableTh } from "@/components/shell/TableControls"

type Protocol = {
  name: string
  chain: string
  tvl: number
  change_1d: unknown
  change_7d: unknown
  category: string
}

export function DeFiPageContent() {
  return <DeFiPageInner />
}



function DeFiPageInner() {
  const [protocols, setProtocols] = useState<Protocol[]>([])
  const [loading, setLoading] = useState(true)
  const [chain, setChain] = useState('')
  const [totalTvl, setTotalTvl] = useState(0)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
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
    <>
      <div className="h-full overflow-auto">
        <div className="sticky top-0 bg-bg-deep z-10 px-4 py-3 border-b border-border-dim">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-bold text-accent-cyan flex items-center gap-2">
                <Layers size={14} /> DeFi DASHBOARD
              </h1>
              <span className="text-xs text-text-dim">Total TVL: <span className="text-accent-green font-mono">${formatTvl(totalTvl)}</span></span>
            </div>
            <span className="text-xs text-text-muted">{protocols.length} protocols · DeFiLlama</span>
          </div>
          <div className="flex gap-2">
            <div className="flex gap-1">
              {['', 'Ethereum', 'Solana', 'BSC', 'Arbitrum', 'Base', 'Polygon', 'Avalanche'].map(c => (
                <button
                  key={c}
                  onClick={() => setChain(c)}
                  className={`px-2 py-0.5 rounded text-xs border font-mono transition-colors ${
                    chain === c ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
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
            <div className="text-center py-20 text-text-dim text-xs">Loading DeFi data from DeFiLlama...</div>
          ) : (
            <>
              <TableControlsBar idPrefix="defi" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
              {tc.visible.length === 0 ? (
                <div className="text-center py-20 text-text-dim text-xs">No protocols found</div>
              ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-xs uppercase">
                  <th className="text-left py-2 px-2">#</th>
                  <SortableTh controls={tc} k="name" className="text-left py-2 px-2 font-mono">PROTOCOL</SortableTh>
                  <SortableTh controls={tc} k="chain" className="text-left py-2 px-2 font-mono">CHAIN</SortableTh>
                  <SortableTh controls={tc} k="category" className="text-left py-2 px-2 font-mono">CATEGORY</SortableTh>
                  <SortableTh controls={tc} k="tvl" className="text-right py-2 px-2 font-mono">TVL</SortableTh>
                  <SortableTh controls={tc} k="change_1d" className="text-right py-2 px-2 font-mono">1D CHANGE</SortableTh>
                  <SortableTh controls={tc} k="change_7d" className="text-right py-2 px-2 font-mono">7D CHANGE</SortableTh>
                </tr>
              </thead>
              <tbody>
                {tc.visible.map((p, i) => (
                  <tr key={p.name + i} className="border-t border-border-dim/30 hover:bg-bg-elevated cursor-pointer transition-colors">
                    <td className="py-2 px-2 text-text-muted">{i + 1}</td>
                    <td className="py-2 px-2 font-mono text-text-primary font-bold">{p.name}</td>
                    <td className="py-2 px-2 text-accent-cyan">{p.chain}</td>
                    <td className="py-2 px-2 text-text-dim">{p.category}</td>
                    <td className="py-2 px-2 text-right font-mono text-accent-green">${formatTvl(Number(p.tvl))}</td>
                    <td className={`py-2 px-2 text-right font-mono flex items-center justify-end gap-0.5 ${Number(p.change_1d) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {Number(p.change_1d) >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {formatChange(p.change_1d)}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${Number(p.change_7d) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {formatChange(p.change_7d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              )}
            </>
          )}
        </div>
      </div>
    </>
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
