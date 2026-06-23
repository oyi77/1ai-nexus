"use client"

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { PriceTag } from '@/components/primitives/PriceTag'
import { AddressChip } from '@/components/primitives/AddressChip'
import { LiveDot } from '@/components/primitives/LiveDot'

interface EntityDetail {
  id: string
  name: string
  type: string
  verified: boolean
  totalUsdValue: number
  chains: string[]
  wallets: Array<{ id: string; address: string; chain: string }>
}

export default function EntityDetailPage() {
  const params = useParams()
  const slug = params?.slug as string
  const [entity, setEntity] = useState<EntityDetail | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  useEffect(() => {
    if (!slug) return
    fetch(`/api/v1/entities?search=${encodeURIComponent(slug)}&pageSize=1`)
      .then(r => r.json())
      .then(d => {
        const items = d.data?.items ?? d.data ?? []
        if (Array.isArray(items) && items.length > 0) {
          const e = items[0]
          setEntity({
            id: String(e.id ?? ''),
            name: String(e.name ?? slug),
            type: String(e.type ?? 'unknown'),
            verified: Boolean(e.verified),
            totalUsdValue: Number(e.totalUsdValue ?? 0),
            chains: Array.isArray(e.chains) ? e.chains : [],
            wallets: Array.isArray(e.wallets) ? e.wallets.map((w: Record<string, unknown>) => ({
              id: String(w.id ?? ''),
              address: String(w.address ?? ''),
              chain: String(w.chain ?? 'ethereum'),
            })) : [],
          })
          setStatus('live')
        } else {
          setStatus('error')
        }
      })
      .catch(() => setStatus('error'))
  }, [slug])

  const typeColors: Record<string, string> = {
    protocol: 'bg-teal-vivid/20 text-teal-vivid',
    exchange: 'bg-accent-amber/20 text-accent-amber',
    fund: 'bg-purple-400/20 text-purple-400',
    bridge: 'bg-data-bear/20 text-data-bear',
    whale: 'bg-data-bull/20 text-data-bull',
    dao: 'bg-blue-400/20 text-blue-400',
  }

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              {entity?.name ?? slug}
              {entity?.verified && <span className="text-teal-vivid text-[14px]">✓ Verified</span>}
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              {entity ? (
                <>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${typeColors[entity.type.toLowerCase()] ?? 'bg-bg-raised text-text-muted'}`}>
                    {entity.type.toUpperCase()}
                  </span>
                  {entity.chains.length > 0 && (
                    <span className="ml-2 text-text-muted">Chains: {entity.chains.join(', ')}</span>
                  )}
                </>
              ) : 'Loading entity data...'}
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {entity ? (
          <div className="grid grid-cols-12 gap-4">
            {/* Left: Entity Info */}
            <div className="col-span-5 space-y-4">
              <Panel title="Entity Overview" subtitle={entity.type}>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-text-muted">Total Value</span>
                    <PriceTag value={entity.totalUsdValue} size="lg" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-text-muted">Wallets</span>
                    <span className="text-[14px] font-mono font-bold text-text-primary">{entity.wallets.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-text-muted">Chains</span>
                    <span className="text-[14px] font-mono font-bold text-text-primary">{entity.chains.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-text-muted">Status</span>
                    <span className={`text-[12px] font-mono font-bold ${entity.verified ? 'text-data-bull' : 'text-accent-amber'}`}>
                      {entity.verified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                </div>
              </Panel>

              {/* AI Analysis */}
              <Panel title="AI Entity Analysis" subtitle="Automated intelligence">
                <div className="p-4 space-y-2 text-[11px] font-mono text-text-secondary leading-relaxed">
                  {entity.type.toLowerCase() === 'exchange' && (
                    <p>{entity.name} is a centralized exchange with {entity.wallets.length} tracked wallets. Monitor for large outflows that may signal market-moving events.</p>
                  )}
                  {entity.type.toLowerCase() === 'protocol' && (
                    <p>{entity.name} is a DeFi protocol with ${(entity.totalUsdValue / 1e9).toFixed(2)}B in total value. Track governance proposals and treasury movements for alpha signals.</p>
                  )}
                  {entity.type.toLowerCase() === 'fund' && (
                    <p>{entity.name} is an investment fund/VC. Track their wallet movements for early positioning in tokens they accumulate.</p>
                  )}
                  {entity.type.toLowerCase() === 'bridge' && (
                    <p>{entity.name} is a cross-chain bridge. Monitor for unusual volume spikes that may indicate arbitrage opportunities or security events.</p>
                  )}
                  {!['exchange', 'protocol', 'fund', 'bridge'].includes(entity.type.toLowerCase()) && (
                    <p>Tracking {entity.name} across {entity.chains.length} chains with {entity.wallets.length} known wallets.</p>
                  )}
                </div>
              </Panel>
            </div>

            {/* Right: Wallets */}
            <div className="col-span-7">
              <Panel title="Tracked Wallets" subtitle={`${entity.wallets.length} addresses`} liveStatus={status}>
                <div className="space-y-1 p-2 max-h-[500px] overflow-y-auto">
                  {entity.wallets.map((w) => (
                    <a
                      key={w.id}
                      href={`/wallet/${w.address}`}
                      className="flex items-center justify-between p-2 hover:bg-bg-raised rounded transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted uppercase">{w.chain}</span>
                        <AddressChip address={w.address} />
                      </div>
                      <span className="text-[10px] text-teal-vivid opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
                    </a>
                  ))}
                  {entity.wallets.length === 0 && (
                    <div className="text-[11px] font-mono text-text-muted p-4 text-center">No wallets tracked yet</div>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        ) : (
          <div className="text-[12px] font-mono text-text-muted p-8 text-center">
            {status === 'error' ? `Entity "${slug}" not found` : 'Loading entity data...'}
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
