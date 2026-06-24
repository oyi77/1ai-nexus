"use client"

import { useState, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { AddressChip } from '@/components/primitives/AddressChip'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { EntityLabel } from '@/components/primitives/EntityLabel'
import { Sparkline } from '@/components/primitives/Sparkline'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface ClusterWallet {
  address: string
  chain: string
  labels: string[]
  riskScore: number
  lastSeen: string
  holdingCount: number
  topHolding?: { symbol: string; usdValue: number }
}

interface WalletCluster {
  id: string
  label: string
  type: string
  verified: boolean
  logoUrl?: string
  wallets: ClusterWallet[]
  walletCount: number
  estimatedSize: number
  change1d: number
  chains: string[]
  connectionMethod: string
  confidence: number
  avgRiskScore: number
  recentTxCount: number
  lastActivity: string
  topTokens: { symbol: string; usdValue: number }[]
  [key: string]: unknown
}

interface ClusterSummary {
  totalClusters: number
  totalAum: number
  avgConfidence: number
  verifiedCount: number
  typeBreakdown: Record<string, number>
  chainBreakdown: Record<string, number>
}

interface ClusterPayload {
  summary: ClusterSummary
  clusters: WalletCluster[]
}

function fmtUsd(n: number): string {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

const ENTITY_TYPE_MAP: Record<string, 'whale' | 'dex' | 'cex' | 'contract' | 'unknown' | 'fund' | 'mev' | 'protocol'> = {
  exchange: 'cex',
  fund: 'fund',
  whale: 'whale',
  protocol: 'protocol',
  mev: 'mev',
  dex: 'dex',
  contract: 'contract',
}

const CHAIN_COLORS: Record<string, string> = {
  ethereum: 'bg-[#627EEA]/20 text-[#627EEA]',
  arbitrum: 'bg-[#28A0F0]/20 text-[#28A0F0]',
  base: 'bg-[#0052FF]/20 text-[#0052FF]',
  optimism: 'bg-[#FF0420]/20 text-[#FF0420]',
  solana: 'bg-[#9945FF]/20 text-[#9945FF]',
  bitcoin: 'bg-[#F7931A]/20 text-[#F7931A]',
}

export default function WhaleClusterPage() {
  const { data, status, refresh } = useLiveFetch<ClusterPayload>({
    url: '/api/v1/whale-cluster',
    interval: 300_000,
  })

  const clusters = data?.clusters ?? []
  const summary = data?.summary

  const [filterType, setFilterType] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = filterType === 'all'
    ? clusters
    : clusters.filter(c => c.type === filterType)

  const entityTypes = useMemo(() => {
    const types = new Set(clusters.map(c => c.type))
    return ['all', ...Array.from(types).sort()]
  }, [clusters])

  const columns: Column<WalletCluster>[] = [
    {
      key: 'label',
      header: 'Entity',
      width: 180,
      render: r => (
        <div className="flex items-center gap-2">
          <EntityLabel
            type={ENTITY_TYPE_MAP[r.type] ?? 'unknown'}
            label={r.label}
            size="xs"
          />
          {r.verified && (
            <span className="text-teal-vivid text-[10px]" title="Verified entity">✓</span>
          )}
        </div>
      ),
    },
    {
      key: 'walletCount',
      header: 'Wallets',
      width: 60,
      align: 'right',
      sortable: true,
      render: r => (
        <span className="text-text-primary font-mono tabular-nums">
          {r.walletCount}
        </span>
      ),
    },
    {
      key: 'estimatedSize',
      header: 'AUM',
      width: 110,
      align: 'right',
      sortable: true,
      render: r => <PriceTag value={r.estimatedSize} size="sm" />,
    },
    {
      key: 'change1d',
      header: '24h Δ',
      width: 80,
      align: 'right',
      sortable: true,
      render: r => <DeltaBadge value={r.change1d} size="xs" />,
    },
    {
      key: 'chains',
      header: 'Chains',
      width: 140,
      render: r => (
        <div className="flex flex-wrap gap-1">
          {r.chains.slice(0, 3).map(ch => (
            <span
              key={ch}
              className={`text-[9px] font-mono px-1 py-0.5 rounded ${CHAIN_COLORS[ch] ?? 'bg-bg-raised text-text-muted'}`}
            >
              {ch}
            </span>
          ))}
          {r.chains.length > 3 && (
            <span className="text-[9px] text-text-muted">+{r.chains.length - 3}</span>
          )}
        </div>
      ),
    },
    {
      key: 'topTokens',
      header: 'Top Holdings',
      width: 160,
      render: r => (
        <div className="flex flex-wrap gap-1">
          {r.topTokens.slice(0, 3).map(t => (
            <span key={t.symbol} className="text-[10px] font-mono text-text-secondary">
              {t.symbol}
              <span className="text-text-muted ml-0.5">{fmtUsd(t.usdValue)}</span>
            </span>
          ))}
          {r.topTokens.length === 0 && (
            <span className="text-[10px] text-text-muted">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'confidence',
      header: 'Conf',
      width: 70,
      align: 'right',
      sortable: true,
      render: r => {
        const pct = Math.round(r.confidence * 100)
        const color = pct >= 90 ? 'text-data-bull' : pct >= 70 ? 'text-data-warn' : 'text-text-muted'
        return (
          <div className="flex items-center gap-1 justify-end">
            <div className="h-1 w-8 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className={`h-full rounded-full ${pct >= 90 ? 'bg-data-bull' : pct >= 70 ? 'bg-data-warn' : 'bg-text-muted'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`font-mono tabular-nums text-[10px] ${color}`}>{pct}%</span>
          </div>
        )
      },
    },
    {
      key: 'avgRiskScore',
      header: 'Risk',
      width: 60,
      align: 'right',
      sortable: true,
      render: r => {
        const score = r.avgRiskScore
        const color = score <= 30 ? 'text-data-bull' : score <= 60 ? 'text-data-warn' : 'text-data-bear'
        return <span className={`font-mono tabular-nums text-[10px] ${color}`}>{score}</span>
      },
    },
    {
      key: 'recentTxCount',
      header: '7d Tx',
      width: 55,
      align: 'right',
      sortable: true,
      render: r => (
        <span className="text-text-primary font-mono tabular-nums text-[10px]">
          {r.recentTxCount}
        </span>
      ),
    },
    {
      key: 'lastActivity',
      header: 'Last Active',
      width: 75,
      align: 'right',
      sortable: true,
      render: r => (
        <span className="text-text-muted font-mono text-[10px]">
          {timeAgo(r.lastActivity)}
        </span>
      ),
    },
  ]

  // Expanded row: show wallet detail
  const renderExpanded = (cluster: WalletCluster) => (
    <div className="px-4 py-3 bg-bg-raised border-t border-bg-border">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Wallet list */}
        <div className="lg:col-span-2">
          <div className="text-[10px] text-text-muted font-mono uppercase mb-2">
            Wallets ({cluster.walletCount})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {cluster.wallets.slice(0, 8).map(w => (
              <div
                key={w.address}
                className="flex items-center gap-2 bg-bg-panel px-2 py-1 rounded"
              >
                <AddressChip address={w.address} truncate={6} size="xs" />
                <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${CHAIN_COLORS[w.chain] ?? 'bg-bg-elevated text-text-muted'}`}>
                  {w.chain}
                </span>
                {w.riskScore > 60 && (
                  <span className="text-[9px] text-data-bear font-mono">⚠ {w.riskScore}</span>
                )}
                {w.topHolding && (
                  <span className="text-[9px] text-text-muted font-mono">
                    {w.topHolding.symbol} {fmtUsd(w.topHolding.usdValue)}
                  </span>
                )}
              </div>
            ))}
            {cluster.wallets.length > 8 && (
              <div className="text-[10px] text-text-muted px-2 py-1">
                +{cluster.wallets.length - 8} more wallets
              </div>
            )}
          </div>
        </div>

        {/* Token breakdown */}
        <div>
          <div className="text-[10px] text-text-muted font-mono uppercase mb-2">
            Top Token Holdings
          </div>
          <div className="space-y-1">
            {cluster.topTokens.slice(0, 5).map(t => {
              const pct = cluster.estimatedSize > 0
                ? (t.usdValue / cluster.estimatedSize) * 100
                : 0
              return (
                <div key={t.symbol} className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-text-primary w-12">{t.symbol}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-vivid"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-text-muted w-16 text-right">
                    {fmtUsd(t.usdValue)}
                  </span>
                </div>
              )
            })}
            {cluster.topTokens.length === 0 && (
              <div className="text-[10px] text-text-muted">No holdings data</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">🐋 Whale Clusters</h1>
            <p className="text-[11px] text-text-muted font-mono">
              Identify connected wallets controlled by the same entity — cross-chain intelligence
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
          <div className="bg-bg-panel border border-bg-border px-3 py-2">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Total Clusters</div>
            <div className="text-[18px] font-head font-bold text-text-primary tabular-nums">
              {summary?.totalClusters ?? 0}
            </div>
            <div className="text-[9px] text-text-muted mt-0.5">
              {summary?.verifiedCount ?? 0} verified entities
            </div>
          </div>
          <div className="bg-bg-panel border border-bg-border px-3 py-2">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Total AUM</div>
            <div className="text-[18px] font-head font-bold text-teal-vivid tabular-nums">
              {fmtUsd(summary?.totalAum ?? 0)}
            </div>
            <div className="text-[9px] text-text-muted mt-0.5">
              Across all tracked entities
            </div>
          </div>
          <div className="bg-bg-panel border border-bg-border px-3 py-2">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Avg Confidence</div>
            <div className="text-[18px] font-head font-bold text-data-bull tabular-nums">
              {Math.round((summary?.avgConfidence ?? 0) * 100)}%
            </div>
            <div className="text-[9px] text-text-muted mt-0.5">
              Cluster identification accuracy
            </div>
          </div>
          <div className="bg-bg-panel border border-bg-border px-3 py-2">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Entity Types</div>
            <div className="text-[18px] font-head font-bold text-text-primary tabular-nums">
              {Object.keys(summary?.typeBreakdown ?? {}).length}
            </div>
            <div className="text-[9px] text-text-muted mt-0.5">
              {Object.entries(summary?.chainBreakdown ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([ch]) => ch)
                .join(', ') || 'No chains'}
            </div>
          </div>
        </div>

        {/* Type breakdown bar */}
        {summary && Object.keys(summary.typeBreakdown).length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <span className="text-[10px] text-text-muted font-mono">Type:</span>
            {Object.entries(summary.typeBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div key={type} className="flex items-center gap-1">
                  <EntityLabel type={ENTITY_TYPE_MAP[type] ?? 'unknown'} size="xs" />
                  <span className="text-[10px] text-text-muted font-mono">{count}</span>
                </div>
              ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono">Filter:</span>
          {entityTypes.map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                filterType === t
                  ? 'bg-teal-dim/30 text-teal-vivid'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {t === 'all' ? 'ALL' : t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Main cluster table */}
        <Panel
          title="Entity Clusters"
          subtitle={`${filtered.length} clusters · sorted by AUM`}
          liveStatus={status}
          onRefresh={refresh}
          maxHeight={600}
        >
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={filtered as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={36}
            onRowClick={(row) => {
              const cluster = row as unknown as WalletCluster
              setExpandedId(prev => prev === cluster.id ? null : cluster.id)
            }}
            emptyState={
              <div className="text-text-muted text-[11px] p-4">
                {status === 'error' ? 'Failed to load cluster data' : 'Loading cluster data...'}
              </div>
            }
          />
        </Panel>

        {/* Expanded detail panel */}
        {expandedId && (() => {
          const cluster = clusters.find(c => c.id === expandedId)
          if (!cluster) return null
          return (
            <Panel
              title={`${cluster.label} — Cluster Detail`}
              subtitle={`${cluster.walletCount} wallets · ${fmtUsd(cluster.estimatedSize)} AUM · ${cluster.connectionMethod}`}
              liveStatus={status}
              maxHeight={400}
            >
              {renderExpanded(cluster)}
            </Panel>
          )
        })()}

        {/* Chain distribution */}
        {summary && Object.keys(summary.chainBreakdown).length > 0 && (
          <Panel
            title="Chain Distribution"
            subtitle={`${Object.keys(summary.chainBreakdown).length} chains`}
            maxHeight={200}
          >
            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {Object.entries(summary.chainBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([chain, count]) => {
                  const pct = summary.totalClusters > 0
                    ? (count / summary.totalClusters) * 100
                    : 0
                  return (
                    <div key={chain} className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${CHAIN_COLORS[chain] ?? 'bg-bg-raised text-text-muted'}`}>
                        {chain}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                        <div
                          className="h-full rounded-full bg-teal-vivid/60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-text-muted tabular-nums w-8 text-right">
                        {count}
                      </span>
                    </div>
                  )
                })}
            </div>
          </Panel>
        )}
      </div>
    </NexusLayout>
  )
}
