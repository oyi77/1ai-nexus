"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface MempoolEvent {
  chain: string
  type: string
  asset: string
  estUsd: number | null
  detectedAt: string
  metadata: Record<string, unknown>
}

interface BridgeStats {
  bridges: Array<{ name: string; volume24h: number; chains: string[] }>
  totalVolume24h: number
}

interface StakingSnapshot {
  asset: string
  entryQueue: number | null
  exitQueue: number | null
  netStaked: number | null
  entryWaitDays: number | null
  exitWaitDays: number | null
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

export default function OnchainIntelPage() {
  const [mempool, setMempool] = useState<MempoolEvent[]>([])
  const [bridge, setBridge] = useState<BridgeStats | null>(null)
  const [staking, setStaking] = useState<StakingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/onchain-intel?action=all')
        const d = await res.json()
        if (d.data?.mempool) setMempool(d.data.mempool)
        if (d.data?.bridge) setBridge(d.data.bridge)
        if (d.data?.staking) setStaking(d.data.staking)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">ON-CHAIN INTELLIGENCE</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Mempool congestion, bridge flows, staking queue — all from public APIs
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Staking Queue */}
        {staking && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">NET STAKED ETH</p>
              <p className="text-lg font-mono font-bold">{staking.netStaked ? `${(staking.netStaked / 1e6).toFixed(1)}M` : '—'}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">ENTRY QUEUE</p>
              <p className="text-lg font-mono font-bold text-data-bull">{staking.entryQueue ?? '—'}</p>
              <p className="text-[9px] text-text-dim">{staking.entryWaitDays ? `~${staking.entryWaitDays}d wait` : ''}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">EXIT QUEUE</p>
              <p className="text-lg font-mono font-bold text-data-bear">{staking.exitQueue ?? '—'}</p>
              <p className="text-[9px] text-text-dim">{staking.exitWaitDays ? `~${staking.exitWaitDays}d wait` : ''}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">SIGNAL</p>
              <p className="text-sm font-mono font-bold">
                {(staking.exitQueue ?? 0) > 10000 ? 'Exit pressure — sell signal' : (staking.entryQueue ?? 0) > 10000 ? 'Entry demand — bullish' : 'Neutral'}
              </p>
            </div>
          </div>
        )}

        {/* Mempool Events */}
        <Panel title="Mempool Alerts" subtitle={`${mempool.length} events`}>
          {mempool.length === 0 ? (
            <div className="text-text-muted text-[11px] p-4 text-center">No mempool alerts — normal conditions</div>
          ) : (
            <div className="divide-y divide-border-dim/30">
              {mempool.map((e, i) => (
                <div key={i} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-amber/20 text-accent-amber">{e.chain}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted">{e.type}</span>
                    </div>
                    <span className="text-[10px] text-text-dim">{new Date(e.detectedAt).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-text-primary mt-1">{String(e.metadata?.signal ?? 'Mempool activity detected')}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Bridge Flows */}
        {bridge && bridge.bridges.length > 0 && (
          <Panel title="Bridge Flows" subtitle={`Top bridges by 24h volume — ${fmtUsd(bridge.totalVolume24h)} total`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 px-2 font-mono">BRIDGE</th>
                    <th className="text-right py-2 px-2 font-mono">24H VOLUME</th>
                    <th className="text-left py-2 px-2 font-mono">CHAINS</th>
                  </tr>
                </thead>
                <tbody>
                  {bridge.bridges.map((b, i) => (
                    <tr key={i} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 px-2 font-mono font-bold text-teal-vivid">{b.name}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtUsd(b.volume24h)}</td>
                      <td className="py-2 px-2 text-text-dim">{b.chains.slice(0, 4).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </NexusLayout>
  )
}
