"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'
import { AddressChip } from '@/components/primitives/AddressChip'
import { AlertPill } from '@/components/primitives/AlertPill'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface InsiderSignal {
  id: string
  walletAddress: string
  chain: string
  totalTxs: number
  walletAge: string
  firstSeen: string
  largeTxAmount: number
  largeTxToken: string
  riskScore: number
  suspicionReasons: string[]
  detectedAt: string
}

interface InsiderResponse { data: InsiderSignal[]; count: number }

export default function InsiderPage() {
  const { data, status, refresh } = useLiveFetch<InsiderResponse>({ url: '/api/v1/insider', interval: 60_000 })
  const signals = data?.data || []

  const columns: Column<InsiderSignal>[] = [
    {
      key: 'riskScore',
      header: 'RISK',
      width: 60,
      align: 'right',
      render: r => (
        <div className="flex items-center gap-1">
          <div className="w-8 h-1.5 bg-bg-border rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${r.riskScore >= 70 ? 'bg-data-bear' : r.riskScore >= 50 ? 'bg-data-warn' : 'bg-data-bull'}`} style={{ width: `${r.riskScore}%` }} />
          </div>
          <span className={`text-[11px] font-mono font-bold ${r.riskScore >= 70 ? 'text-data-bear' : r.riskScore >= 50 ? 'text-data-warn' : 'text-data-bull'}`}>{r.riskScore}</span>
        </div>
      ),
    },
    {
      key: 'walletAddress',
      header: 'Wallet',
      width: 120,
      render: r => <AddressChip address={r.walletAddress} truncate={6} size="sm" />,
    },
    {
      key: 'chain',
      header: 'Chain',
      width: 60,
      render: r => <span className="text-text-muted text-[10px] font-mono">{r.chain}</span>,
    },
    {
      key: 'totalTxs',
      header: 'Txs',
      width: 40,
      align: 'right',
      render: r => <span className={`font-mono ${r.totalTxs <= 2 ? 'text-data-bear font-bold' : 'text-text-secondary'}`}>{r.totalTxs}</span>,
    },
    {
      key: 'walletAge',
      header: 'Age',
      width: 50,
      align: 'right',
      render: r => <span className={`font-mono ${r.walletAge.includes('h') ? 'text-data-bear' : 'text-text-secondary'}`}>{r.walletAge}</span>,
    },
    {
      key: 'largeTxAmount',
      header: 'Amount',
      width: 100,
      align: 'right',
      render: r => <PriceTag value={r.largeTxAmount} size="sm" />,
    },
    {
      key: 'suspicionReasons',
      header: 'Why Suspicious',
      width: 300,
      render: r => (
        <div className="flex flex-wrap gap-1">
          {r.suspicionReasons.slice(0, 2).map((reason, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-data-bear/10 text-data-bear text-[9px] font-mono">
              {reason}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'detectedAt',
      header: 'Detected',
      width: 70,
      align: 'right',
      render: r => <span className="text-text-muted text-[10px]">{new Date(r.detectedAt).toLocaleString()}</span>,
    },
  ]

  const highRisk = signals.filter(s => s.riskScore >= 70).length
  const medRisk = signals.filter(s => s.riskScore >= 50 && s.riskScore < 70).length

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">🔍 Insider Detector</h1>
            <p className="text-[11px] text-text-muted font-mono">Fresh wallets with sudden large transactions — classic insider accumulation pattern</p>
          </div>
          <LiveDot status={status} label />
        </div>
        {status === 'error' && <div className="text-data-bear text-[11px] font-mono p-4">Error: Failed to fetch insider signals</div>}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
          {[
            { label: 'Total Signals', value: String(signals.length), color: 'text-text-primary' },
            { label: 'High Risk (≥70)', value: String(highRisk), color: 'text-data-bear' },
            { label: 'Medium Risk (50-69)', value: String(medRisk), color: 'text-data-warn' },
            { label: 'Detection Window', value: 'Last 30 days', color: 'text-text-secondary' },
          ].map((k, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">{k.label}</div>
              <div className={`text-[16px] font-head font-bold tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Signals Table */}
        <Panel
          title="Insider Signals"
          subtitle="Ranked by risk score — fresh wallets with large txs"
          liveStatus={status}
          onRefresh={refresh}
          maxHeight={600}
        >
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={signals as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={36}
            emptyState={
              <div className="p-8 text-center">
                <div className="text-[14px] text-text-primary mb-2">No insider signals detected</div>
                <div className="text-[11px] text-text-muted">This is good — means no suspicious fresh wallet activity</div>
                <div className="text-[10px] text-text-muted mt-2">Signals appear when wallets with &lt;10 transactions move &gt;$100K</div>
              </div>
            }
          />
        </Panel>

        {/* How it works */}
        <Panel title="How It Works" subtitle="Detection methodology">
          <div className="p-3 space-y-2 text-[11px] text-text-secondary">
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">1.</span>
              <span>Scan all transactions with value &gt;$100K</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">2.</span>
              <span>Check if the wallet has fewer than 10 total transactions (fresh wallet)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">3.</span>
              <span>Check if wallet was created within the last 30 days</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">4.</span>
              <span>Calculate risk score based on: amount size, tx count, wallet age, token type</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">5.</span>
              <span>Rank by risk score — higher = more suspicious</span>
            </div>
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
