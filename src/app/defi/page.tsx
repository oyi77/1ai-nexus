"use client"

import { useState, useEffect, useCallback } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { Layers, TrendingUp, TrendingDown, Search } from "lucide-react"

interface Protocol {
  name: string
  chain: string
  tvl: number
  change_1d: unknown
  change_7d: unknown
  category: string
}

export default function DeFiPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([])
  const [loading, setLoading] = useState(true)
  const [chain, setChain] = useState('')
  const [search, setSearch] = useState('')
  const [totalTvl, setTotalTvl] = useState(0)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (chain) params.set('chain', chain)
      const res = await fetch(`/api/v1/defi/tvl?${params}`)
      const data = await res.json()
      setProtocols(data.protocols ?? [])
      setTotalTvl(data.totalTvl ?? 0)
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [chain])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = protocols.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <TerminalShell>
      <div className="h-full overflow-auto">
        <div className="sticky top-0 bg-bg-deep z-10 px-4 py-3 border-b border-border-dim">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
                <Layers size={14} /> DeFi DASHBOARD
              </h1>
              <span className="text-xs text-text-dim">Total TVL: <span className="text-accent-green font-mono">${formatTvl(totalTvl)}</span></span>
            </div>
            <span className="text-[10px] text-text-muted">{protocols.length} protocols · DeFiLlama</span>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search protocols..."
                className="w-full bg-bg-panel border border-border-dim rounded pl-7 pr-3 py-1 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
              />
            </div>
            <div className="flex gap-1">
              {['', 'Ethereum', 'Solana', 'BSC', 'Arbitrum', 'Base', 'Polygon', 'Avalanche'].map(c => (
                <button
                  key={c}
                  onClick={() => setChain(c)}
                  className={`px-2 py-0.5 rounded text-[10px] border font-mono transition-colors ${
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
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-text-dim text-xs">No protocols found</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-[10px] uppercase">
                  <th className="text-left py-2 px-2 font-mono">#</th>
                  <th className="text-left py-2 px-2 font-mono">PROTOCOL</th>
                  <th className="text-left py-2 px-2 font-mono">CHAIN</th>
                  <th className="text-left py-2 px-2 font-mono">CATEGORY</th>
                  <th className="text-right py-2 px-2 font-mono">TVL</th>
                  <th className="text-right py-2 px-2 font-mono">1D CHANGE</th>
                  <th className="text-right py-2 px-2 font-mono">7D CHANGE</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
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
        </div>
      </div>
    </TerminalShell>
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
