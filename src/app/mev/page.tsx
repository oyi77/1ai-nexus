"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

// ── Types matching API response ──────────────────────────

interface MevEvent {
  type: string
  txHash: string
  profit: number
  profitEth: number
  block: number
  strategy: string
  victimTx?: string
  gasUsed: number
  gasPriceGwei: number
  confidence: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  botAddress: string
}

interface MevStats {
  totalMEV24h: number
  totalProfitEth: number
  avgProfit: number
  topStrategies: Array<{ name: string; count: number }>
  bySeverity: Record<string, number>
  blocksScanned: number
  scanTimeMs: number
  ethPriceUsd: number
}

interface TopBot {
  address: string
  eventCount: number
  totalProfitEth: number
}

interface ScannedRange {
  fromBlock: number
  toBlock: number
}

// ── Component ────────────────────────────────────────────

export default function MevPage() {
  const [events, setEvents] = useState<MevEvent[]>([])
  const [stats, setStats] = useState<MevStats | null>(null)
  const [topBots, setTopBots] = useState<TopBot[]>([])
  const [scannedRange, setScannedRange] = useState<ScannedRange | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/mev')
      const d = await res.json()
      if (d.data) {
        setEvents(d.data.recentMEV ?? [])
        setStats(d.data.stats ?? null)
        setTopBots(d.data.topBots ?? [])
        setScannedRange(d.data.scannedRange ?? null)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
fetchData()
    const iv = setInterval(fetchData, 15_000)
    return () => clearInterval(iv)
  }, [fetchData])

  const typeIcons: Record<string, string> = {
    sandwich: '🥪',
    arbitrage: '⚡',
    'jit-liquidity': '💧',
    frontrun: '🏃',
    backrun: '🔙',
    liquidation: '💥',
  }

  const typeColors: Record<string, string> = {
    sandwich: 'bg-data-bear/20 text-data-bear',
    arbitrage: 'bg-data-bull/20 text-data-bull',
    'jit-liquidity': 'bg-blue-500/20 text-blue-400',
    frontrun: 'bg-accent-amber/20 text-accent-amber',
    backrun: 'bg-purple-500/20 text-purple-400',
    liquidation: 'bg-red-500/20 text-red-400',
  }

  const severityColors: Record<string, string> = {
    low: 'text-text-muted',
    medium: 'text-accent-amber',
    high: 'text-data-bear',
    critical: 'text-red-400 font-bold',
  }

  const hasData = events.length > 0
  const hasError = status === 'error'

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-data-bear">🛡</span> MEV Detector
            </h1>
            <p className="text-[12px] text-text-muted mt-1">
              Maximal Extractable Value monitoring. Detects sandwich attacks, frontrunning, and arbitrage bots.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {scannedRange && (
              <span className="text-xs font-mono text-text-muted">
                Blocks {scannedRange.fromBlock.toLocaleString()} – {scannedRange.toBlock.toLocaleString()}
              </span>
            )}
            <LiveDot status={status} label />
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-2">
          <KPI label="MEV Events" value={String(events.length)} color={events.length > 0 ? 'text-data-bear' : undefined} />
          <KPI
            label="Total Profit"
            value={stats && stats.totalMEV24h > 0 ? `$${stats.totalMEV24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
            color={stats && stats.totalMEV24h > 0 ? 'text-data-bear' : undefined}
          />
          <KPI
            label="Avg Profit"
            value={stats && stats.avgProfit > 0 ? `$${stats.avgProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
          />
          <KPI
            label="ETH Price"
            value={stats ? `$${stats.ethPriceUsd.toLocaleString()}` : '—'}
          />
        </div>

        {/* Strategy Breakdown */}
        {stats && stats.topStrategies.length > 0 && (
          <Panel title="MEV Strategies" subtitle="Breakdown by attack type" liveStatus={status}>
            <div className="p-3 grid grid-cols-4 gap-3">
              {stats.topStrategies.map((s) => (
                <div key={s.name} className="bg-bg-raised p-3 rounded border border-bg-border">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[14px]">{typeIcons[s.name] ?? '•'}</span>
                    <span className="text-xs font-mono text-text-muted uppercase">{s.name}</span>
                  </div>
                  <div className="text-[20px] font-head font-bold text-text-primary tabular-nums">{s.count}</div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Severity Breakdown */}
        {stats && stats.bySeverity && Object.values(stats.bySeverity).some(v => v > 0) && (
          <Panel title="Severity Distribution" subtitle={`${stats.blocksScanned} blocks scanned in ${stats.scanTimeMs}ms`} liveStatus={status}>
            <div className="p-3 grid grid-cols-4 gap-3">
              {(['low', 'medium', 'high', 'critical'] as const).map(sev => (
                <div key={sev} className="bg-bg-raised p-3 rounded border border-bg-border">
                  <div className="text-xs font-mono text-text-muted uppercase mb-1">{sev}</div>
                  <div className={`text-[20px] font-head font-bold tabular-nums ${severityColors[sev]}`}>
                    {stats.bySeverity[sev] ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Top MEV Bots */}
        {topBots.length > 0 && (
          <Panel title="Top MEV Bots" subtitle="Most active detected bots" liveStatus={status}>
            <div className="p-2 space-y-1">
              {topBots.slice(0, 5).map((bot, i) => (
                <div key={bot.address} className="flex items-center gap-3 py-2 px-3 bg-bg-raised/50 rounded border border-bg-border/30">
                  <span className="text-xs font-mono text-text-muted w-4">{i + 1}</span>
                  <span className="text-xs font-mono text-teal-vivid">{bot.address.slice(0, 6)}...{bot.address.slice(-4)}</span>
                  <span className="text-xs font-mono text-text-primary tabular-nums">{bot.eventCount} events</span>
                  <span className="text-xs font-mono text-data-bear tabular-nums ml-auto">{bot.totalProfitEth.toFixed(4)} ETH</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Recent MEV Events */}
        <Panel title="Recent MEV Events" subtitle={hasData ? `${events.length} detected from mempool analysis` : 'Detected from mempool analysis'} liveStatus={status} onRefresh={fetchData}>
          <div className="space-y-1 p-2">
            {hasError ? (
              <div className="p-8 text-center">
                <div className="text-[13px] text-text-primary mb-2">Connection error</div>
                <div className="text-xs text-text-muted font-mono">Failed to reach MEV detection service — will retry automatically</div>
              </div>
            ) : hasData ? (
              events.map((e, i) => (
                <div key={`${e.txHash}-${i}`} className="flex items-center gap-3 py-2 px-3 border-b border-bg-border/50 hover:bg-bg-raised transition-colors">
                  <span className="text-[16px]">{typeIcons[e.type] ?? '•'}</span>
                  <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${typeColors[e.type] ?? 'bg-bg-raised text-text-muted'}`}>
                    {e.type.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-text-muted flex-1 truncate" title={e.txHash}>{e.txHash.slice(0, 16)}…</span>
                  <span className="text-xs font-mono text-text-primary hidden md:inline">{e.strategy.length > 30 ? e.strategy.slice(0, 30) + '…' : e.strategy}</span>
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${severityColors[e.severity] ?? 'text-text-muted'} bg-bg-raised`}>
                    {e.severity}
                  </span>
                  <span className="text-[12px] font-mono font-bold text-data-bear tabular-nums">${e.profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  <span className="text-xs font-mono text-text-muted">Block {e.block.toLocaleString()}</span>
                  {e.confidence > 0 && (
                    <span className="text-xs font-mono text-text-muted tabular-nums">{e.confidence}%</span>
                  )}
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <div className="text-[13px] text-text-primary mb-2">No MEV activity detected</div>
                <div className="text-xs text-text-muted font-mono">
                  Scanning recent Ethereum blocks for sandwich attacks, frontrunning, and arbitrage bots. This may take a moment.
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}

// ── Sub-components ───────────────────────────────────────

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-xs text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}
