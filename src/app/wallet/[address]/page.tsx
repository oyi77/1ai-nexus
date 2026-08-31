"use client"

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { AddressChip } from '@/components/primitives/AddressChip'
import { LiveDot } from '@/components/primitives/LiveDot'
import { FollowButton } from '@/components/primitives/FollowButton'

interface EntityInfo {
  id: string
  name: string
  type: string
  verified: boolean
  totalUsdValue: number
}

interface WalletTransaction {
  id: string
  chain: string
  txHash: string
  from: string | null
  to: string | null
  amountUsd: number
  tokenSymbol: string | null
  isMEV: boolean
  timestamp: string
  [key: string]: unknown
}

interface RelatedEntity {
  wallet: string
  label: string
  entityId: string | null
  type: string
  totalUsd: number
  count: number
}

interface WalletData {
  entity: EntityInfo | null
  transactions: WalletTransaction[]
  txCount: number
  totalVolume: number
  chains: string[]
  relatedEntities: RelatedEntity[]
}

export default function WalletDetailPage() {
  const params = useParams()
  const address = params?.address as string
  const [data, setData] = useState<WalletData | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  useEffect(() => {
    if (!address) return

    const fetchData = async () => {
      try {
        const [entityRes, txRes, catRes] = await Promise.allSettled([
          fetch(`/api/v1/entities?search=${encodeURIComponent(address)}&pageSize=1`).then(r => r.json()),
          fetch(`/api/v1/flows?address=${encodeURIComponent(address)}&limit=20`).then(r => r.json()),
          fetch('/api/v1/entities?pageSize=100&sort=totalUsdValue&order=desc').then(r => r.json()),
        ])

        // Build name -> {id,type} map so related entities get a real type badge + deep link
        const entityCatalog = new Map<string, { id: string; type: string }>()
        if (catRes.status === 'fulfilled') {
          const cats = catRes.value?.data?.items ?? catRes.value?.data ?? []
          if (Array.isArray(cats)) {
            for (const c of cats) {
              if (c && c.name) entityCatalog.set(String(c.name).toLowerCase(), {
                id: String(c.id ?? ''),
                type: String(c.type ?? 'unknown'),
              })
            }
          }
        }

        let entity: EntityInfo | null = null
        if (entityRes.status === 'fulfilled') {
          const items = entityRes.value?.data?.items ?? entityRes.value?.data ?? []
          if (Array.isArray(items) && items.length > 0) {
            const e = items[0]
            entity = {
              id: String(e.id ?? ''),
              name: String(e.name ?? 'Unknown'),
              type: String(e.type ?? 'unknown'),
              verified: Boolean(e.verified),
              totalUsdValue: Number(e.totalUsdValue ?? 0),
            }
          }
        }

        let transactions: WalletTransaction[] = []
        if (txRes.status === 'fulfilled') {
          const flows = txRes.value?.data?.flows ?? txRes.value?.data ?? []
          if (Array.isArray(flows)) {
            transactions = flows.slice(0, 20).map((f: Record<string, unknown>, i: number) => ({
              id: String(f.id ?? `tx-${i}`),
              chain: String(f.chain ?? 'ethereum'),
              txHash: String(f.txHash ?? f.hash ?? ''),
              from: f.from ? String(f.from) : null,
              to: f.to ? String(f.to) : null,
              amountUsd: Number(f.amountUsd ?? f.totalUsd ?? 0),
              tokenSymbol: f.tokenSymbol ? String(f.tokenSymbol) : null,
              isMEV: Boolean(f.isMEV),
              timestamp: f.timestamp ? String(f.timestamp) : '',
            }))
          }
        }

        // Related entities: aggregate the flows payload by entity for the interactions panel
        let relatedEntities: RelatedEntity[] = []
        if (txRes.status === 'fulfilled') {
          const flowsArr = txRes.value?.data?.items ?? txRes.value?.data?.flows ?? txRes.value?.data ?? []
          if (Array.isArray(flowsArr)) {
            relatedEntities = flowsArr.slice(0, 20).map((f: Record<string, unknown>) => {
              const wallet = String(f.wallet ?? '')
              const rawLabel = String(f.entity ?? f.label ?? 'Unknown')
              const known = rawLabel !== 'Unknown' && !/^0x[0-9a-f]{6,}$/i.test(rawLabel)
                ? entityCatalog.get(rawLabel.toLowerCase())
                : undefined
              return {
                wallet,
                label: known ? rawLabel : (wallet || rawLabel),
                entityId: known?.id ?? null,
                type: known?.type ?? (wallet ? 'wallet' : 'unknown'),
                totalUsd: Number(f.totalUsd ?? 0),
                count: Number(f.count ?? 1),
              }
            })
          }
        }

        const totalVolume = transactions.reduce((sum, t) => sum + t.amountUsd, 0)
        const chains = [...new Set(transactions.map(t => t.chain))]

        setData({ entity, transactions, txCount: transactions.length, totalVolume, chains, relatedEntities })
        setStatus('live')
      } catch {
        setStatus('error')
      }
    }

    fetchData()
  }, [address])

  const txColumns: Column<WalletTransaction>[] = [
    { key: 'txHash', header: 'Tx Hash', width: 180, render: r => (
      <span className="text-text-muted font-mono text-xs">{String(r.txHash).slice(0, 18)}...</span>
    )},
    { key: 'chain', header: 'Chain', width: 80, render: r => (
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-bg-raised text-teal-vivid uppercase">{r.chain}</span>
    )},
    { key: 'from', header: 'From', width: 120, render: r => (
      <span className="text-text-muted font-mono text-xs">{r.from ? `${r.from.slice(0, 10)}...` : '—'}</span>
    )},
    { key: 'to', header: 'To', width: 120, render: r => (
      <span className="text-text-muted font-mono text-xs">{r.to ? `${r.to.slice(0, 10)}...` : '—'}</span>
    )},
    { key: 'amountUsd', header: 'USD Value', width: 100, align: 'right', render: r => (
      <PriceTag value={r.amountUsd} size="sm" />
    )},
    { key: 'tokenSymbol', header: 'Token', width: 80, render: r => (
      <span className="text-text-primary font-mono text-xs">{r.tokenSymbol ?? 'ETH'}</span>
    )},
    { key: 'isMEV', header: 'MEV', width: 50, align: 'center', render: r => (
      r.isMEV ? <span className="text-accent-amber text-xs font-bold">⚠</span> : <span className="text-text-muted text-xs">—</span>
    )},
  ]

  const entityColumns: Column<RelatedEntity>[] = [
    { key: 'label', header: 'Entity', width: 200, render: r => (
      r.entityId ? (
        <Link href={`/entity/${encodeURIComponent(r.entityId)}`} className="text-text-primary font-mono text-xs hover:text-teal-vivid transition-colors">
          {r.label}
        </Link>
      ) : r.wallet ? (
        <Link href={`/wallet/${encodeURIComponent(r.wallet)}`} className="text-text-muted font-mono text-xs hover:text-teal-vivid transition-colors">
          {r.label.length > 16 ? `${r.label.slice(0, 10)}…${r.label.slice(-4)}` : r.label}
        </Link>
      ) : (
        <span className="text-text-muted font-mono text-xs">{r.label}</span>
      )
    )},
    { key: 'type', header: 'Type', width: 90, render: r => (
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
        r.type === 'exchange' ? 'bg-accent-amber/20 text-accent-amber' :
        r.type === 'fund' ? 'bg-purple-400/20 text-purple-400' :
        r.type === 'whale' ? 'bg-data-bull/20 text-data-bull' :
        r.type === 'protocol' ? 'bg-teal-vivid/20 text-teal-vivid' :
        'bg-bg-raised text-text-secondary'
      }`}>
        {r.type.toUpperCase()}
      </span>
    )},
    { key: 'totalUsd', header: 'Total USD', width: 110, align: 'right', render: r => (
      <PriceTag value={r.totalUsd} size="sm" />
    )},
    { key: 'count', header: 'Trades', width: 70, align: 'right', render: r => (
      <span className="text-text-primary font-mono text-xs tabular-nums">{r.count}</span>
    )},
  ]

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              {data?.entity?.name ?? 'Unknown Wallet'}
              {data?.entity?.verified && <span className="text-teal-vivid text-[14px]">✓</span>}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <AddressChip address={address} />
              {data?.entity && (
                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                  data.entity.type === 'exchange' ? 'bg-accent-amber/20 text-accent-amber' :
                  data.entity.type === 'fund' ? 'bg-purple-400/20 text-purple-400' :
                  data.entity.type === 'whale' ? 'bg-data-bull/20 text-data-bull' :
                  'bg-teal-vivid/20 text-teal-vivid'
                }`}>
                  {data.entity.type.toUpperCase()}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FollowButton type="wallet" id={address} />
            <LiveDot status={status} label />
          </div>
        </div>

        {/* Wallet Stats */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="Total Volume" value={data ? `$${(data.totalVolume / 1e6).toFixed(2)}M` : '—'} />
          <StatCard label="Transactions" value={data ? String(data.txCount) : '—'} />
          <StatCard label="Active Chains" value={data ? String(data.chains.length) : '—'} />
          <StatCard label="Entity TVL" value={data?.entity ? `$${(data.entity.totalUsdValue / 1e9).toFixed(2)}B` : 'N/A'} />
        </div>

        {/* Transaction History */}
        <Panel title="Transaction History" subtitle={`${data?.txCount ?? 0} recent on-chain transactions`} liveStatus={status}>
          <DataTable
            columns={txColumns as unknown as Column<Record<string, unknown>>[]}
            data={data?.transactions as unknown as Record<string, unknown>[] ?? []}
            rowHeight={32}
            emptyState={<div className="text-text-muted text-[12px] p-8 text-center">No transactions yet. Indexer is scanning live...</div>}
          />
        </Panel>

        {/* Entity Interactions */}
        <Panel title="Entity Interactions" subtitle={`${data?.relatedEntities?.length ?? 0} entities detected`} liveStatus={status}>
          <DataTable
            columns={entityColumns as unknown as Column<Record<string, unknown>>[]}
            data={data?.relatedEntities as unknown as Record<string, unknown>[] ?? []}
            rowHeight={32}
            emptyState={<div className="text-text-muted text-[12px] p-8 text-center">No entity interactions detected yet. Indexer is scanning live...</div>}
          />
        </Panel>

        {/* AI Wallet Analysis */}
        {data?.entity && (
          <Panel title="AI Wallet Analysis" subtitle="Automated intelligence report">
            <div className="p-4 space-y-2 text-[12px] font-mono text-text-secondary leading-relaxed">
              {data.entity.type === 'exchange' && (
                <p>
                  This wallet belongs to <span className="text-text-primary font-bold">{data.entity.name}</span>, a centralized exchange.
                  Monitor for large outflows indicating potential sell pressure, and large inflows indicating user deposits.
                  TVL: <span className="text-teal-vivid">${(data.entity.totalUsdValue / 1e9).toFixed(2)}B</span>.
                  Activity detected on <span className="text-text-primary">{data.chains.join(', ') || 'no chains yet'}</span>.
                </p>
              )}
              {data.entity.type === 'fund' && (
                <p>
                  This wallet belongs to <span className="text-text-primary font-bold">{data.entity.name}</span>, an investment fund.
                  Track accumulator patterns for early positioning signals. Funds typically deploy capital gradually.
                  AUM: <span className="text-teal-vivid">${(data.entity.totalUsdValue / 1e9).toFixed(2)}B</span>.
                </p>
              )}
              {data.entity.type === 'whale' && (
                <p>
                  This wallet belongs to <span className="text-text-primary font-bold">{data.entity.name}</span>, a known whale.
                  Large transfers from this wallet can cause significant market impact. Monitor for movement patterns.
                </p>
              )}
              {data.entity.type === 'protocol' && (
                <p>
                  This wallet belongs to <span className="text-text-primary font-bold">{data.entity.name}</span>, a DeFi protocol.
                  Treasury movements may signal governance decisions or strategic investments.
                  TVL: <span className="text-teal-vivid">${(data.entity.totalUsdValue / 1e9).toFixed(2)}B</span>.
                </p>
              )}
              {!['exchange', 'fund', 'whale', 'protocol'].includes(data.entity.type) && (
                <p>Tracking wallet {address.slice(0, 10)}... across {data.chains.length} chains.</p>
              )}
            </div>
          </Panel>
        )}
      </div>
    </NexusLayout>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-xs text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className="text-[18px] font-head font-bold tabular-nums text-text-primary">{value}</div>
    </div>
  )
}