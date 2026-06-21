"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { AddressChip } from '@/components/primitives/AddressChip'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface WalletCluster {
  id: string
  wallets: string[]
  estimatedSize: number
  connectionMethod: string
  confidence: number
  label?: string
}

interface ClusterResponse { data: WalletCluster[]; count: number }

export default function WhaleClusterPage() {
  const { data, status, refresh } = useLiveFetch<ClusterResponse>({ url: '/api/v1/whale-cluster', interval: 300_000 })
  const clusters = data?.data || []

  const columns: Column<WalletCluster>[] = [
    {
      key: 'label',
      header: 'Entity',
      width: 120,
      render: r => <span className="text-teal-vivid font-bold">{r.label || r.id}</span>,
    },
    {
      key: 'wallets',
      header: 'Wallets',
      width: 200,
      render: r => (
        <div className="flex flex-wrap gap-1">
          {r.wallets.slice(0, 3).map((w, i) => <AddressChip key={i} address={w} truncate={6} size="xs" />)}
          {r.wallets.length > 3 && <span className="text-[10px] text-text-muted">+{r.wallets.length - 3}</span>}
        </div>
      ),
    },
    {
      key: 'estimatedSize',
      header: 'Est. Size',
      width: 100,
      align: 'right',
      render: r => <PriceTag value={r.estimatedSize} size="sm" />,
    },
    {
      key: 'wallets',
      header: 'Count',
      width: 50,
      align: 'right',
      render: r => <span className="text-text-primary font-mono">{r.wallets.length}</span>,
    },
    {
      key: 'connectionMethod',
      header: 'Method',
      width: 120,
      render: r => <span className="text-text-secondary text-[10px]">{r.connectionMethod}</span>,
    },
    {
      key: 'confidence',
      header: 'Conf',
      width: 60,
      align: 'right',
      render: r => (
        <span className={`font-mono ${r.confidence > 0.8 ? 'text-data-bull' : r.confidence > 0.5 ? 'text-data-warn' : 'text-data-neutral'}`}>
          {Math.round(r.confidence * 100)}%
        </span>
      ),
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">🐋 Whale Clusters</h1>
            <p className="text-[11px] text-text-muted font-mono">Identify connected wallets controlled by the same entity</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <Panel
          title="Known Entity Clusters"
          subtitle={`${clusters.length} clusters identified`}
          liveStatus={status}
          onRefresh={refresh}
          maxHeight={600}
        >
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={clusters as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={36}
            emptyState={<div className="text-text-muted text-[11px] p-4">Loading cluster data...</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
