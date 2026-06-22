"use client"

import { useState, useEffect, useCallback } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { Percent } from "lucide-react"

interface YieldPool {
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
      setPools(data.pools ?? [])
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [stableOnly])

  useEffect(() => { const invoke = () => fetchData(); invoke() }, [fetchData])

  return (
    <TerminalShell>
      <div className="h-full overflow-auto">
        <div className="sticky top-0 bg-bg-deep z-10 px-4 py-3 border-b border-border-dim">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
              <Percent size={14} /> DeFi YIELD FINDER
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => setStableOnly(!stableOnly)}
                className={`px-2 py-0.5 rounded text-[10px] border font-mono transition-colors ${
                  stableOnly ? 'bg-accent-green/20 border-accent-green text-accent-green' : 'bg-bg-panel border-border-dim text-text-dim'
                }`}
              >
                STABLECOIN ONLY
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-2">
          {loading ? (
            <div className="text-center py-20 text-text-dim text-xs">Loading yield data from DeFiLlama...</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-[10px] uppercase">
                  <th className="text-left py-2 px-2 font-mono">#</th>
                  <th className="text-left py-2 px-2 font-mono">PROTOCOL</th>
                  <th className="text-left py-2 px-2 font-mono">CHAIN</th>
                  <th className="text-left py-2 px-2 font-mono">SYMBOL</th>
                  <th className="text-right py-2 px-2 font-mono">TVL</th>
                  <th className="text-right py-2 px-2 font-mono">APY</th>
                  <th className="text-right py-2 px-2 font-mono">BASE</th>
                  <th className="text-right py-2 px-2 font-mono">REWARD</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p, i) => (
                  <tr key={p.pool + i} className="border-t border-border-dim/30 hover:bg-bg-elevated cursor-pointer">
                    <td className="py-2 px-2 text-text-muted">{i + 1}</td>
                    <td className="py-2 px-2 font-mono text-text-primary">{p.project}</td>
                    <td className="py-2 px-2 text-accent-cyan">{p.chain}</td>
                    <td className="py-2 px-2 text-text-dim">{p.symbol}</td>
                    <td className="py-2 px-2 text-right font-mono">${formatTvl(Number(p.tvlUsd))}</td>
                    <td className="py-2 px-2 text-right font-mono text-accent-green font-bold">{Number(p.apy).toFixed(2)}%</td>
                    <td className="py-2 px-2 text-right font-mono text-text-dim">{formatPct(p.apyBase)}</td>
                    <td className="py-2 px-2 text-right font-mono text-text-dim">{formatPct(p.apyReward)}</td>
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
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toFixed(0)
}

function formatPct(v: unknown): string {
  const n = Number(v)
  return isNaN(n) ? '—' : `${n.toFixed(2)}%`
}
