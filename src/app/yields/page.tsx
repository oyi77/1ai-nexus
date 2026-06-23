"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface YieldPool {
  pool: string
  project: string
  symbol: string
  chain: string
  tvlUsd: number
  apy: number
  apyBase: number
  apyReward: number
  stablecoin: boolean
  ilRisk: string
  prediction: string
  confidence: number
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

const chainColors: Record<string, string> = {
  ethereum: 'text-blue-400',
  solana: 'text-purple-400',
  arbitrum: 'text-blue-300',
  base: 'text-blue-500',
  optimism: 'text-red-400',
  polygon: 'text-purple-300',
  avalanche: 'text-red-300',
  bsc: 'text-yellow-400',
}

export default function YieldsPage() {
  const [topYields, setTopYields] = useState<YieldPool[]>([])
  const [stableYields, setStableYields] = useState<YieldPool[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [filter, setFilter] = useState<'all' | 'low-risk' | 'high-apy'>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/yields')
      const d = await res.json()
      if (d.success && d.data) {
        setTopYields(d.data.topYields ?? [])
        setStableYields(d.data.stableYields ?? [])
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 300_000) // 5min
    return () => clearInterval(id)
  }, [fetchData])

  const filtered = filter === 'low-risk'
    ? topYields.filter(y => y.ilRisk === 'no')
    : filter === 'high-apy'
    ? topYields.filter(y => y.apy > 20)
    : topYields

  const avgApy = topYields.length > 0 ? topYields.reduce((s, y) => s + y.apy, 0) / topYields.length : 0
  const totalTvl = topYields.reduce((s, y) => s + y.tvlUsd, 0)

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-data-bull">🌾</span> DeFi Yield Farming
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Top yield opportunities from DeFiLlama. 15,975+ pools tracked. Real APY data.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-5 gap-2">
          <KPI label="Total Pools" value="15,975+" />
          <KPI label="Top APY" value={topYields.length > 0 ? `${topYields[0].apy.toFixed(1)}%` : '—'} color="text-data-bull" />
          <KPI label="Avg Top 50 APY" value={`${avgApy.toFixed(1)}%`} />
          <KPI label="Top 50 TVL" value={fmtUsd(totalTvl)} />
          <KPI label="Stablecoin Pools" value={String(stableYields.length)} />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-text-muted uppercase">Filter:</span>
          <div className="flex bg-bg-raised p-1 rounded">
            {(['all', 'low-risk', 'high-apy'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-mono rounded uppercase transition-colors ${filter === f ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Top Yields */}
        <Panel title="Top Yield Opportunities" subtitle={`${filtered.length} pools | Sorted by APY`} liveStatus={status}>
          <div className="overflow-auto scrollbar-thin">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-text-muted">
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">#</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Protocol</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Asset</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Chain</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">TVL</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">APY</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Base APY</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Reward APY</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-center">IL Risk</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-center">Prediction</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 50).map((pool, i) => (
                  <tr key={pool.pool} className="border-b border-bg-border/30 hover:bg-bg-raised transition-colors">
                    <td className="text-[11px] font-mono px-3 py-1.5 text-text-muted">{i + 1}</td>
                    <td className="text-[12px] font-mono px-3 py-1.5 font-bold text-text-primary">{pool.project}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-teal-vivid">{pool.symbol}</td>
                    <td className={`text-[10px] font-mono px-3 py-1.5 ${chainColors[pool.chain] ?? 'text-text-muted'}`}>
                      {pool.chain}
                    </td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-secondary tabular-nums">{fmtUsd(pool.tvlUsd)}</td>
                    <td className="text-[13px] font-mono px-3 py-1.5 text-right font-bold text-data-bull tabular-nums">{pool.apy.toFixed(2)}%</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-text-primary tabular-nums">{pool.apyBase.toFixed(2)}%</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-accent-amber tabular-nums">{pool.apyReward.toFixed(2)}%</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        pool.ilRisk === 'no' ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                      }`}>
                        {pool.ilRisk === 'no' ? 'NO' : 'YES'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        pool.prediction === 'Up' ? 'bg-data-bull/20 text-data-bull' :
                        pool.prediction === 'Down' ? 'bg-data-bear/20 text-data-bear' :
                        'bg-bg-raised text-text-muted'
                      }`}>
                        {pool.prediction}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Stablecoin Yields */}
        <Panel title="Stablecoin Yields" subtitle={`${stableYields.length} stablecoin pools | Lower risk`} liveStatus={status}>
          <div className="p-3 grid grid-cols-4 gap-3">
            {stableYields.slice(0, 8).map((pool, i) => (
              <div key={i} className="bg-bg-raised p-3 rounded border border-bg-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-mono font-bold text-text-primary">{pool.project}</span>
                  <span className={`text-[10px] font-mono ${chainColors[pool.chain] ?? 'text-text-muted'}`}>{pool.chain}</span>
                </div>
                <div className="text-[10px] font-mono text-text-muted mb-2">{pool.symbol}</div>
                <div className="text-[20px] font-head font-bold text-data-bull tabular-nums">{pool.apy.toFixed(2)}%</div>
                <div className="text-[10px] font-mono text-text-muted">TVL: {fmtUsd(pool.tvlUsd)}</div>
              </div>
            ))}
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