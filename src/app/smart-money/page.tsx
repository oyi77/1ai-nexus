"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { EntityLabel } from '@/components/primitives/EntityLabel'
import { Sparkline } from '@/components/primitives/Sparkline'
import { LiveDot } from '@/components/primitives/LiveDot'

interface SmartMoneySignal {
  id: string
  wallet: string
  walletLabel: string
  action: 'Accumulated' | 'Exited' | 'Swapped' | 'Bridged'
  token: string
  amount: number
  amountUsd: number
  score: number
  confidence: number
  timestamp: string
  chain: string
  sparkline: number[]
  [key: string]: unknown
}

interface TopWallet {
  address: string
  label: string
  type: string
  score: number
  pnl30d: number
  winRate: number
  tradeCount: number
  avgSize: number
  sparkline: number[]
  [key: string]: unknown
}

export default function SmartMoneyPage() {
  const [signals, setSignals] = useState<SmartMoneySignal[]>([])
  const [topWallets, setTopWallets] = useState<TopWallet[]>([])
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [filterAction, setFilterAction] = useState<string>('all')

  const fetchData = useCallback(async () => {
    try {
      const [smRes, copyTradeRes] = await Promise.allSettled([
        fetch('/api/v1/smart-money?pageSize=20').then(r => r.json()),
        fetch('/api/v1/copy-trade?limit=10').then(r => r.json()),
      ])

      // Real smart money wallets from DB
      if (smRes.status === 'fulfilled' && smRes.value?.data) {
        setTopWallets(smRes.value.data.map((w: Record<string, unknown>, i: number) => {
          const wallet = w.wallet as Record<string, unknown> || {}
          return {
            address: (wallet.address as string || `wallet-${i}`).slice(0, 20),
            label: (wallet.labels as string[])?.[0] || w.category as string || 'Smart Money',
            type: (w.category as string || 'unknown').toLowerCase(),
            score: w.score as number || 0,
            pnl30d: 0,
            winRate: 0,
            tradeCount: 0,
            avgSize: 0,
            sparkline: Array.from({ length: 20 }, (_, j) => 50 + Math.sin(j + i) * 20),
          }
        }))
      }

      // Real copy trade signals
      if (copyTradeRes.status === 'fulfilled' && copyTradeRes.value?.data) {
        setSignals(copyTradeRes.value.data.map((s: Record<string, unknown>, i: number) => ({
          id: s.id as string || `sig-${i}`,
          wallet: (s.walletAddress as string || '').slice(0, 20),
          walletLabel: s.walletLabel as string || 'Unknown',
          action: (s.action as string || 'swap').charAt(0).toUpperCase() + (s.action as string || 'swap').slice(1) as SmartMoneySignal['action'],
          token: s.tokenIn as string || 'UNKNOWN',
          amount: 0,
          amountUsd: s.amountUsd as number || 0,
          score: Math.round((s.confidence as number || 0) * 100),
          confidence: s.confidence as number || 0,
          timestamp: new Date(s.timestamp as string).toLocaleTimeString(),
          chain: 'multi',
          sparkline: Array.from({ length: 20 }, (_, j) => 50 + Math.sin(j + i) * 15),
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

  const filteredSignals = filterAction === 'all'
    ? signals
    : signals.filter(s => s.action === filterAction)

  const signalColumns: Column<SmartMoneySignal>[] = [
    {
      key: 'walletLabel',
      header: 'Wallet',
      width: 120,
      render: (row) => (
        <div className="flex items-center gap-1">
          <EntityLabel type={row.walletLabel.includes('Fund') ? 'fund' : 'whale'} size="xs" />
          <span className="text-text-primary truncate">{row.walletLabel}</span>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      width: 90,
      render: (row) => (
        <span className={`font-mono text-[10px] ${
          row.action === 'Accumulated' ? 'text-data-bull' :
          row.action === 'Exited' ? 'text-data-bear' :
          'text-data-orange'
        }`}>
          {row.action}
        </span>
      ),
    },
    {
      key: 'token',
      header: 'Token',
      width: 50,
      render: (row) => <span className="text-teal-vivid font-bold">{row.token}</span>,
    },
    {
      key: 'amountUsd',
      header: 'Value',
      width: 100,
      align: 'right',
      render: (row) => <PriceTag value={row.amountUsd} size="sm" />,
    },
    {
      key: 'score',
      header: 'Score',
      width: 50,
      align: 'right',
      render: (row) => (
        <span className={`font-mono ${row.score >= 80 ? 'text-data-bull' : row.score >= 60 ? 'text-data-warn' : 'text-data-bear'}`}>
          {row.score}
        </span>
      ),
    },
    {
      key: 'confidence',
      header: 'Conf',
      width: 50,
      align: 'right',
      render: (row) => <span className="text-text-muted">{(row.confidence * 100).toFixed(0)}%</span>,
    },
    {
      key: 'timestamp',
      header: 'Time',
      width: 70,
      align: 'right',
      render: (row) => <span className="text-text-muted">{row.timestamp}</span>,
    },
  ]

  const walletColumns: Column<TopWallet>[] = [
    {
      key: 'label',
      header: 'Type',
      width: 100,
      render: (row) => <EntityLabel type={row.type as 'fund' | 'whale' | 'mev' | 'cex' | 'dex'} label={row.label} size="xs" />,
    },
    {
      key: 'address',
      header: 'Address',
      width: 120,
      render: (row) => <span className="font-mono text-text-primary">{row.address}</span>,
    },
    {
      key: 'score',
      header: 'Score',
      width: 50,
      align: 'right',
      render: (row) => <span className="text-teal-vivid font-bold">{row.score}</span>,
    },
    {
      key: 'pnl30d',
      header: '30d PnL',
      width: 70,
      align: 'right',
      render: (row) => <DeltaBadge value={row.pnl30d} size="xs" />,
    },
    {
      key: 'winRate',
      header: 'Win%',
      width: 50,
      align: 'right',
      render: (row) => <span className="text-data-bull">{row.winRate.toFixed(1)}%</span>,
    },
    {
      key: 'tradeCount',
      header: 'Trades',
      width: 50,
      align: 'right',
      render: (row) => <span className="text-text-secondary">{row.tradeCount}</span>,
    },
    {
      key: 'sparkline',
      header: '30d',
      width: 50,
      render: (row) => <Sparkline data={row.sparkline} width={40} height={14} />,
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Smart Money</h1>
            <p className="text-[11px] text-text-muted font-mono">Track high-win-rate wallets and their moves</p>
          </div>
          <LiveDot status={feedStatus} label />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-text-muted">Action:</span>
            {['all', 'Accumulated', 'Exited', 'Swapped', 'Bridged'].map(a => (
              <button
                key={a}
                onClick={() => setFilterAction(a)}
                className={`px-2 py-1 rounded ${filterAction === a ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {a === 'all' ? 'ALL' : a}
              </button>
            ))}
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
          {/* Signals Feed */}
          <Panel
            title="Smart Money Signals"
            subtitle={`${filteredSignals.length} signals`}
            liveStatus={feedStatus}
            maxHeight={500}
          >
            <DataTable
              columns={signalColumns}
              data={filteredSignals}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">No signals matching filter</div>}
            />
          </Panel>

          {/* Top Wallets */}
          <Panel
            title="Top Wallets"
            subtitle="Ranked by score"
            liveStatus={feedStatus}
            maxHeight={500}
          >
            <DataTable
              columns={walletColumns}
              data={topWallets}
              sortable
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Loading wallet rankings...</div>}
            />
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
