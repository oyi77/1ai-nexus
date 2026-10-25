"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { TableControlsBar, SortableTh, useTableControls } from '@/components/shell/TableControls'

interface MempoolEvent {
  chain: string
  type: string
  asset: string
  estUsd: number | null
  detectedAt: string
  confirmedAt: string | null
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
  timestamp: string
}
type SourceStatus = 'live' | 'stale' | 'unavailable'
type Sources = Partial<Record<'mempool' | 'bridge' | 'staking', SourceStatus>>

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

export default function OnchainIntelPage() {
  const [mempool, setMempool] = useState<MempoolEvent[]>([])
  const [bridge, setBridge] = useState<BridgeStats | null>(null)
  const [staking, setStaking] = useState<StakingSnapshot | null>(null)
  const [sources, setSources] = useState<Sources>({})
  const [requestFailed, setRequestFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const tc = useTableControls(
    bridge?.bridges,
    [{ key: 'chains', accessor: b => b.chains.slice(0, 4).join(', ') }],
    { initialSortKey: 'volume24h', initialSortDir: 'desc' },
  )

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/onchain-intel?action=all')
        const d = await res.json()
        if (!res.ok || !d.data) throw new Error(d.error ?? 'On-chain intelligence unavailable')
        setMempool(Array.isArray(d.data.mempool) ? d.data.mempool : [])
        setBridge(d.data.bridge ?? null)
        setStaking(d.data.staking ?? null)
        setSources(d.data.sources ?? {})
        setRequestFailed(false)
      } catch { setRequestFailed(true) }
      setLoading(false)
    }
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [])

  const statuses = Object.values(sources)
  const liveStatus = requestFailed || statuses.includes('unavailable') ? 'error' : loading || statuses.includes('stale') ? 'stale' : 'live'
  const stakingStatus = sources.staking ?? 'unavailable'
  const bridgeStatus = sources.bridge ?? 'unavailable'
  const mempoolStatus = sources.mempool ?? 'unavailable'

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">ON-CHAIN INTELLIGENCE</h1>
            <p className="text-xs text-text-muted mt-1">Public API data with per-source availability</p>
          </div>
          <LiveDot status={liveStatus} label />
        </div>

        <Panel title="Beacon Validator Queue" subtitle={`${stakingStatus.toUpperCase()} · wait times require churn-rate calculation`}>
          {staking ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3">
              <div><p className="text-xs text-text-muted">TOTAL STAKED ETH</p><p className="text-lg font-bold">{staking.netStaked === null ? '—' : `${(staking.netStaked / 1e6).toFixed(1)}M`}</p></div>
              <div><p className="text-xs text-text-muted">PENDING ENTRY</p><p className="text-lg font-bold">{staking.entryQueue ?? '—'}</p></div>
              <div><p className="text-xs text-text-muted">ACTIVE EXITING</p><p className="text-lg font-bold">{staking.exitQueue ?? '—'}</p></div>
            </div>
          ) : <div className="text-text-muted text-xs p-4 text-center">Beacon validator data unavailable</div>}
        </Panel>

        <Panel title="Verified Transfer Events" subtitle={`${mempoolStatus.toUpperCase()} · ${mempool.length} events`}>
          {mempool.length === 0 ? (
            <div className="text-text-muted text-xs p-4 text-center">{mempoolStatus === 'unavailable' ? 'Transfer source unavailable' : 'No verified large-transfer events'}</div>
          ) : (
            <div className="divide-y divide-border-dim/30">
              {mempool.map((event, i) => (
                <div key={i} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><span className="text-xs font-mono text-accent-amber">{event.chain}</span><span className="text-xs font-mono text-text-muted">{event.type}</span></div>
                    <span className="text-xs text-text-dim">{new Date(event.detectedAt).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-text-primary mt-1">{String(event.metadata?.signal ?? 'Verified transfer event')}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Bridge Volume" subtitle={`${bridgeStatus.toUpperCase()}${bridge ? ` · ${fmtUsd(bridge.totalVolume24h)}` : ''}`}>
          {bridge && bridge.bridges.length > 0 ? <>
            <TableControlsBar idPrefix="onchain-intel" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-text-muted border-b border-border-dim"><SortableTh controls={tc} k="name" className="text-left py-2 px-2 font-mono">BRIDGE</SortableTh><SortableTh controls={tc} k="volume24h" className="text-right py-2 px-2 font-mono">24H VOLUME</SortableTh><SortableTh controls={tc} k="chains" className="text-left py-2 px-2 font-mono">CHAINS</SortableTh></tr></thead>
              <tbody>{tc.visible.map(b => <tr key={b.name} className="border-b border-border-dim/30"><td className="py-2 px-2 font-mono font-bold text-teal-vivid">{b.name}</td><td className="py-2 px-2 text-right font-mono">{fmtUsd(b.volume24h)}</td><td className="py-2 px-2 text-text-dim">{b.chains.slice(0, 4).join(', ')}</td></tr>)}</tbody>
            </table></div>
          </> : <div className="text-text-muted text-xs p-4 text-center">{bridgeStatus === 'unavailable' ? 'Bridge source unavailable' : 'No bridge volume reported'}</div>}
        </Panel>
      </div>
    </NexusLayout>
  )
}
