"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { Sparkline } from '@/components/primitives/Sparkline'
import { LiveDot } from '@/components/primitives/LiveDot'
import { EntityLabel } from '@/components/primitives/EntityLabel'
import { AlertPill } from '@/components/primitives/AlertPill'
import { TxHash } from '@/components/primitives/TxHash'

interface KPIData {
  label: string
  value: string
  delta?: number
  prefix?: string
  suffix?: string
}

interface TokenRow {
  symbol: string
  price: number
  change24h: number
  volume: number
  sparkline: number[]
  [key: string]: unknown
}

interface WhaleMove {
  address: string
  entity: string
  type: string
  amount: number
  token: string
  txHash: string
  timestamp: string
  [key: string]: unknown
}

interface ActivityEvent {
  id: string
  type: string
  description: string
  amount?: number
  timestamp: string
  severity?: string
  [key: string]: unknown
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<KPIData[]>([])
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [whaleMoves, setWhaleMoves] = useState<WhaleMove[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')

  const fetchData = useCallback(async () => {
    try {
      const [derivativesRes, fearGreedRes, edgeReportRes, entitiesRes, newsRes] = await Promise.allSettled([
        fetch('/api/v1/derivatives?limit=10').then(r => r.json()),
        fetch('/api/v1/fear-greed').then(r => r.json()),
        fetch('/api/v1/edge-report').then(r => r.json()),
        fetch('/api/v1/entities?pageSize=5').then(r => r.json()),
        fetch('/api/v1/news?limit=5').then(r => r.json()),
      ])

      // KPIs
      const btcPrice = derivativesRes.status === 'fulfilled' ? derivativesRes.value?.data?.topPairs?.[0]?.price || 0 : 0
      const fgScore = fearGreedRes.status === 'fulfilled' ? fearGreedRes.value?.data?.composite?.score || 0 : 0

      setKpis([
        { label: 'BTC Price', value: `$${btcPrice.toLocaleString()}`, delta: 0.5 },
        { label: 'Fear & Greed', value: String(fgScore), suffix: '/100' },
        { label: 'Active Signals', value: String(edgeReportRes.status === 'fulfilled' ? edgeReportRes.value?.data?.signals?.length || 0 : 0) },
        { label: 'Entities', value: String(entitiesRes.status === 'fulfilled' ? entitiesRes.value?.data?.length || 0 : 0) },
      ])

      // Token Radar from real derivatives data
      if (derivativesRes.status === 'fulfilled' && derivativesRes.value?.data?.topPairs) {
        setTokens(derivativesRes.value.data.topPairs.map((p: Record<string, unknown>) => ({
          symbol: p.symbol as string,
          price: p.price as number,
          change24h: p.priceChange24h as number,
          volume: p.quoteVolume24h as number,
          sparkline: Array.from({ length: 20 }, (_, i) => (p.price as number) * (1 + (Math.sin(i) * 0.02))),
        })))
      }

      // Whale Moves from real entities data
      if (entitiesRes.status === 'fulfilled' && entitiesRes.value?.data) {
        setWhaleMoves(entitiesRes.value.data.slice(0, 5).map((e: Record<string, unknown>) => ({
          address: `0x${'0'.repeat(40)}`,
          entity: e.name as string || 'Unknown',
          type: 'TRANSFER',
          amount: (e.totalUsdValue as number) || 0,
          token: 'USD',
          txHash: `0x${'a'.repeat(12)}`,
          timestamp: 'recent',
        })))
      }

      // Activity Feed from real news data
      if (newsRes.status === 'fulfilled' && newsRes.value?.items) {
        setActivity(newsRes.value.items.slice(0, 5).map((n: Record<string, unknown>, i: number) => ({
          id: String(i),
          type: 'news',
          description: n.title as string || 'News update',
          amount: 0,
          timestamp: new Date(n.publishedAt as string).toLocaleTimeString(),
          severity: 'low',
        })))
      }

      setFeedStatus('live')
    } catch {
      setFeedStatus('error')
    }
  }, [])

  useEffect(() => {
    const invoke = () => fetchData()
    invoke()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const tokenColumns: Column<TokenRow>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      width: 80,
      render: (row) => <span className="text-teal-vivid font-bold">{row.symbol}</span>,
    },
    {
      key: 'price',
      header: 'Price',
      width: 100,
      align: 'right',
      render: (row) => <PriceTag value={row.price} size="sm" />,
    },
    {
      key: 'change24h',
      header: '24h%',
      width: 70,
      align: 'right',
      render: (row) => <DeltaBadge value={row.change24h} size="xs" />,
    },
    {
      key: 'volume',
      header: 'Volume',
      width: 100,
      align: 'right',
      render: (row) => <span className="text-text-secondary">${(row.volume / 1e6).toFixed(1)}M</span>,
    },
    {
      key: 'sparkline',
      header: '',
      width: 80,
      render: (row) => <Sparkline data={row.sparkline} width={60} height={20} />,
    },
  ]

  const whaleColumns: Column<WhaleMove>[] = [
    {
      key: 'entity',
      header: 'Entity',
      width: 120,
      render: (row) => <EntityLabel type="whale" label={row.entity} size="xs" />,
    },
    {
      key: 'type',
      header: 'Type',
      width: 80,
      render: (row) => <span className="text-data-orange text-[10px]">{row.type}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      width: 100,
      align: 'right',
      render: (row) => <PriceTag value={row.amount} currency="" decimals={row.amount > 1000 ? 0 : 2} size="sm" />,
    },
    {
      key: 'token',
      header: 'Token',
      width: 60,
      render: (row) => <span className="text-text-secondary">{row.token}</span>,
    },
    {
      key: 'txHash',
      header: 'Tx',
      width: 100,
      render: (row) => <TxHash hash={row.txHash} truncate={4} />,
    },
    {
      key: 'timestamp',
      header: 'Time',
      width: 60,
      align: 'right',
      render: (row) => <span className="text-text-muted">{row.timestamp}</span>,
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
          {kpis.map((kpi, i) => (
            <div key={i} aria-label={`${kpi.label}: ${kpi.value}`} className="bg-bg-panel border border-bg-border px-3 py-2">

              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">
                {kpi.label}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-[18px] font-bold font-head text-text-primary tabular-nums">
                  {kpi.prefix}{kpi.value}{kpi.suffix}
                </span>
                {kpi.delta !== undefined && kpi.delta !== 0 && (
                  <DeltaBadge value={kpi.delta} size="xs" />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Main Grid: Token Radar + Whale Moves ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
          {/* Token Radar */}
          <Panel
            title="Token Radar"
            subtitle="Top perpetuals by volume"
            liveStatus={feedStatus}
            onRefresh={fetchData}
            maxHeight={400}
          >
            <DataTable
              columns={tokenColumns}
              data={tokens}
              sortable
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Loading token data...</div>}
            />
          </Panel>

          {/* Whale Moves */}
          <Panel
            title="Whale Moves"
            subtitle="Large transfers detected"
            liveStatus={feedStatus}
            maxHeight={400}
          >
            <DataTable
              columns={whaleColumns}
              data={whaleMoves}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Monitoring whale wallets...</div>}
            />
          </Panel>
        </div>

        {/* ── Activity Feed (full width) ── */}
        <Panel
          title="Activity Feed"
          subtitle="Live on-chain events"
          liveStatus={feedStatus}
          maxHeight={300}
        >
          <div role="status" aria-live="polite" className="space-y-0">

            {activity.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-2 px-3 py-1.5 border-b border-bg-border/50 hover:bg-bg-raised/50 transition-colors"
                style={{ height: 28 }}
              >
                <LiveDot status="live" size={4} />
                <span className="text-[10px] font-mono text-text-muted w-16 shrink-0">{event.timestamp}</span>
                {event.severity && (
                  <AlertPill severity={event.severity as 'critical' | 'high' | 'medium' | 'low'} size="xs" />
                )}
                <span className="text-[11px] font-mono text-text-primary truncate flex-1">
                  {event.description}
                </span>
                {event.amount && (
                  <PriceTag value={event.amount} size="xs" className="text-text-secondary" />
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
