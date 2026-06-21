"use client"

import { useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
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
}

interface MempoolStatsResponse {
  count: number
  vsize: number
  totalFee: number
  avgFee: number
  fees: FeeLevel[]
  congestion: Congestion
}

interface WhaleTx {
  txid: string
  fee: number
  vsize: number
  valueBtc: number
  valueUsd: number
  rate: number
  age: number
}

interface WhaleResponse {
  data: WhaleTx[]
  count: number
  threshold: string
}

// ── Helpers ───────────────────────────────────────────────

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`
  return String(sats)
}

function formatVsize(vb: number): string {
  if (vb >= 1_000_000) return `${(vb / 1_000_000).toFixed(1)} MB`
  if (vb >= 1_000) return `${(vb / 1_000).toFixed(0)} KB`
  return `${vb} vB`
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
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

export default function MempoolPage() {
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

  const fees = statsData?.fees ?? []
  const congestion = statsData?.congestion
  const whales = whaleData?.data ?? []

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
          className="font-mono text-[11px] text-teal-vivid hover:underline"
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
          {r.valueBtc.toFixed(4)} BTC
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
        <span className="font-mono text-[11px] text-text-primary tabular-nums">
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
        <span className="font-mono text-[11px] text-text-muted tabular-nums">
          {formatSats(r.fee)} sat
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
        <span className={`font-mono text-[11px] tabular-nums ${r.rate > 50 ? 'text-data-bear' : r.rate > 20 ? 'text-data-warn' : 'text-data-bull'}`}>
          {r.rate.toFixed(1)}
        </span>
      ),
    },
    {
      key: 'vsize',
      header: 'Size',
      width: 70,
      align: 'right',
      render: r => (
        <span className="font-mono text-[11px] text-text-muted">
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
        <span className={`font-mono text-[11px] tabular-nums ${r.age > 600 ? 'text-data-bear' : 'text-text-muted'}`}>
          {formatAge(r.age)}
        </span>
      ),
    },
  ], [])

  const refreshAll = async () => {
    await Promise.all([refreshStats(), refreshWhales()])
  }

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio size={20} className="text-teal-vivid" />
            <div>
              <h1 className="text-[20px] font-head font-bold text-text-primary">Mempool Radar</h1>
              <p className="text-[11px] text-text-muted font-mono">Pending whale transactions — alpha before confirmation</p>
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
                  <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">{fee.label}</div>
                  <div className={`text-[18px] font-head font-bold tabular-nums ${isHot ? 'text-data-bear' : fee.rate > 20 ? 'text-data-warn' : 'text-data-bull'}`}>
                    {fee.rate}
                  </div>
                  <div className="text-[10px] text-text-muted font-mono">sat/vB · {fee.range}</div>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* Stats Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
          {[
            {
              label: 'Pending Txs',
              value: (statsData?.count ?? 0).toLocaleString(),
              color: 'text-text-primary',
            },
            {
              label: 'Mempool Size',
              value: formatVsize(statsData?.vsize ?? 0),
              color: 'text-text-primary',
            },
            {
              label: 'Total Fees',
              value: `${formatSats(statsData?.totalFee ?? 0)} sat`,
              color: 'text-data-bull',
            },
            {
              label: 'Avg Fee',
              value: `${formatSats(statsData?.avgFee ?? 0)} sat`,
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
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">{k.label}</div>
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
          subtitle={`Unconfirmed txs ≥ 10 BTC · ${whales.length} found`}
          liveStatus={whaleStatus}
          onRefresh={refreshWhales}
          maxHeight={600}
        >
          <DataTable
            columns={whaleColumns as unknown as Column<Record<string, unknown>>[]}
            data={whales as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={36}
            emptyState={
              <div className="p-8 text-center">
                <div className="text-[14px] text-text-primary mb-2">No whale transactions in mempool</div>
                <div className="text-[11px] text-text-muted">Pending txs ≥ 10 BTC will appear here before confirmation</div>
                <div className="text-[10px] text-text-muted mt-1">Auto-refreshes every 10 seconds</div>
              </div>
            }
          />
        </Panel>

        {/* How it works */}
        <Panel title="How Mempool Radar Works" subtitle="Detection methodology">
          <div className="p-3 space-y-2 text-[11px] text-text-secondary">
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
    </NexusLayout>
  )
}
