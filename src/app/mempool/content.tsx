"use client"

import { useMemo } from 'react'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'
import { Radio } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────

interface FeeLevel {
  label: string
  range: string
  rate: number
}

interface Congestion {
  level: string
  label: string
  color: string
  description?: string
}

interface MempoolStatsResponse {
  count: number
  vsize: number
  totalFee: number
  avgFee: number
  fees: Record<string, number>
  congestion: Congestion
}

interface WhaleTx {
  txid: string
  fee: number | null
  vsize: number | null
  valueBtc: number
  valueUsd: number | null
  rate: number | null
  age: number | null
}

interface WhaleResponse {
  transactions: WhaleTx[]
  count: number
  threshold: string
  note?: string
}

function formatSats(sats: number | null): string {
  if (!Number.isFinite(sats)) return '—'
  const value = sats as number
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function formatVsize(vb: number | null): string {
  if (!Number.isFinite(vb)) return '—'
  const value = vb as number
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} KB`
  return `${value} vB`
}

function formatAge(seconds: number | null): string {
  if (!Number.isFinite(seconds) || (seconds as number) < 0) return '—'
  const value = seconds as number
  if (value < 60) return `${Math.floor(value)}s`
  if (value < 3600) return `${Math.floor(value / 60)}m`
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`
}

function formatUsd(n: number | null): string {
  if (!Number.isFinite(n)) return '—'
  const value = n as number
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function congestionBg(level: string): string {
  switch (level) {
    case 'low': return 'bg-data-bull/20 text-data-bull'
    case 'medium': return 'bg-data-warn/20 text-data-warn'
    case 'high': return 'bg-orange-500/20 text-orange-500'
    case 'extreme': return 'bg-data-bear/20 text-data-bear'
    default: return 'bg-bg-raised text-text-muted'
  }
}

function txidShort(txid: string): string {
  return `${txid.slice(0, 8)}…${txid.slice(-6)}`
}

// ── Page ──────────────────────────────────────────────────

export function MempoolPageContent() {
  return <MempoolPageInner />
}



function MempoolPageInner() {
  const { data: statsData, status: statsStatus, refresh: refreshStats } =
    useLiveFetch<MempoolStatsResponse>({
      url: '/api/v1/mempool?action=stats',
      interval: 10_000,
    })

  const { data: whaleData, status: whaleStatus, refresh: refreshWhales } =
    useLiveFetch<WhaleResponse>({
      url: '/api/v1/mempool?action=whale',
      interval: 10_000,
    })

  const fees: FeeLevel[] = statsData?.fees
    ? Object.entries(statsData.fees as Record<string, number>).map(([key, rate]) => ({
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
        range: key.replace('Fee', ''),
        rate,
      }))
    : []
  const congestion: Congestion | undefined = statsData?.congestion
    ? { ...statsData.congestion, label: statsData.congestion.label ?? statsData.congestion.description ?? statsData.congestion.level }
    : undefined
  const whales: WhaleTx[] = whaleData?.transactions ?? []

  const whaleColumns: Column<WhaleTx>[] = useMemo(() => [
    {
      key: 'txid',
      header: 'TX Hash',
      width: 160,
      render: r => (
        <a
          href={`https://blockstream.info/tx/${r.txid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-teal-vivid hover:underline"
          title={r.txid}
        >
          {txidShort(r.txid)}
        </a>
      ),
    },
    {
      key: 'valueBtc',
      header: 'Value (BTC)',
      width: 110,
      align: 'right',
      sortable: true,
      render: r => (
        <span className="font-mono text-[12px] font-bold text-data-bull tabular-nums">
          {(r.valueBtc ?? 0).toFixed(4)} BTC
        </span>
      ),
    },
    {
      key: 'valueUsd',
      header: 'Value (USD)',
      width: 100,
      align: 'right',
      sortable: true,
      render: r => (
        <span className="font-mono text-xs text-text-primary tabular-nums">
          {formatUsd(r.valueUsd)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Fee',
      width: 80,
      align: 'right',
      render: r => (
        <span className="font-mono text-xs text-text-muted tabular-nums">
          {r.fee === null ? '—' : `${formatSats(r.fee)} sat`}
        </span>
      ),
    },
    {
      key: 'rate',
      header: 'sat/vB',
      width: 70,
      align: 'right',
      sortable: true,
      render: r => (
        <span className={`font-mono text-xs tabular-nums ${r.rate !== null && r.rate > 50 ? 'text-data-bear' : r.rate !== null && r.rate > 20 ? 'text-data-warn' : 'text-text-muted'}`}>
          {r.rate === null ? '—' : r.rate.toFixed(1)}
        </span>
      ),
    },
    {
      key: 'vsize',
      header: 'Size',
      width: 70,
      align: 'right',
      render: r => (
        <span className="font-mono text-xs text-text-muted">
          {formatVsize(r.vsize)}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      width: 60,
      align: 'right',
      sortable: true,
      render: r => (
        <span className={`font-mono text-xs tabular-nums ${r.age !== null && r.age > 600 ? 'text-data-bear' : 'text-text-muted'}`}>
          {formatAge(r.age)}
        </span>
      ),
    },
  ], [])

  const refreshAll = async () => {
    await Promise.all([refreshStats(), refreshWhales()])
  }

  return (
    <>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio size={20} className="text-teal-vivid" />
            <div>
              <h1 className="text-[20px] font-head font-bold text-text-primary">Mempool Radar</h1>
              <p className="text-xs text-text-muted">Pending whale transactions — alpha before confirmation</p>
            </div>
          </div>
          <LiveDot status={statsStatus} label />
        </div>

        {/* Gas Strip */}
        <Panel title="Fee Market" subtitle="Bitcoin network fee estimates" liveStatus={statsStatus} onRefresh={refreshAll}>
          <div className="grid grid-cols-4 divide-x divide-bg-border">
            {fees.map((fee, i) => {
              const isHot = fee.rate > 50
              return (
                <div key={i} className="px-3 py-2 text-center">
                  <div className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">{fee.label}</div>
                  <div className={`text-[18px] font-head font-bold tabular-nums ${isHot ? 'text-data-bear' : fee.rate > 20 ? 'text-data-warn' : 'text-data-bull'}`}>
                    {fee.rate}
                  </div>
                  <div className="text-xs text-text-muted font-mono">sat/vB · {fee.range}</div>
                </div>
              )
            })}
          </div>
          {fees.length === 0 && <div className="p-4 text-center text-xs text-text-muted">{statsStatus === 'error' ? 'Fee estimates temporarily unavailable' : 'Loading fee estimates…'}</div>}
        </Panel>

        {/* Stats Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
          {[
            {
              label: 'Pending Txs',
              value: statsData ? statsData.count.toLocaleString() : '—',
              color: 'text-text-primary',
            },
            {
              label: 'Mempool Size',
              value: statsData ? formatVsize(statsData.vsize) : '—',
              color: 'text-text-primary',
            },
            {
              label: 'Total Fees',
              value: statsData ? `${formatSats(statsData.totalFee)} sat` : '—',
              color: 'text-data-bull',
            },
            {
              label: 'Avg Fee',
              value: statsData ? `${formatSats(statsData.avgFee)} sat` : '—',
              color: 'text-data-warn',
            },
            {
              label: 'Congestion',
              value: congestion?.label ?? '—',
              color: congestion?.color ?? 'text-text-muted',
              badge: congestion ? congestionBg(congestion.level) : '',
            },
          ].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">{k.label}</div>
              <div className={`text-[16px] font-head font-bold tabular-nums ${k.color}`}>
                {k.badge ? (
                  <span className={`px-1.5 py-0.5 rounded text-[12px] ${k.badge}`}>{k.value}</span>
                ) : (
                  k.value
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Whale Pending Txs */}
        <Panel
          title="Pending Whale Transactions"
          subtitle={whaleStatus === 'error' ? 'Unconfirmed transaction source unavailable' : `Unconfirmed txs ≥ 10 BTC · ${whales.length} found`}
          liveStatus={whaleStatus}
          onRefresh={refreshWhales}
          maxHeight={600}
        >
          <DataTable
            columns={whaleColumns as unknown as Column<Record<string, unknown>>[]}
            data={whales as unknown as Record<string, unknown>[]}
            sortable
            filterable
            filterPlaceholder="Filter transactions…"
            rowHeight={36}
            emptyState={
              <div className="p-8 text-center">
                <div className="text-[14px] text-text-primary mb-2">{whaleStatus === 'error' ? 'Whale data temporarily unavailable' : 'No whale transactions in mempool'}</div>
                <div className="text-xs text-text-muted">{whaleStatus === 'error' ? 'Could not retrieve unconfirmed transactions. Refresh to retry.' : 'Pending txs ≥ 10 BTC will appear here before confirmation'}</div>
                <div className="text-xs text-text-muted mt-1">Auto-refreshes every 10 seconds</div>
              </div>
            }
          />
        </Panel>

        {/* How it works */}
        <Panel title="How Mempool Radar Works" subtitle="Detection methodology">
          <div className="p-3 space-y-2 text-xs text-text-secondary">
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">1.</span>
              <span>Monitor Bitcoin mempool via Blockstream API for pending (unconfirmed) transactions</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">2.</span>
              <span>Filter for transactions with estimated value ≥ 10 BTC (~$100K) — whale activity</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">3.</span>
              <span>Track fee rate to gauge urgency — whales paying premium fees signal conviction</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">4.</span>
              <span>Monitor age — older unconfirmed whale txs may signal stuck or RBF activity</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">5.</span>
              <span>Data refreshes every 10 seconds — mempool moves fast, stale data is useless</span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}
