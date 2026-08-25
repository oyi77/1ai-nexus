"use client"

import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

type Opportunity = {
  type: string
  symbol: string
  buyAt: string
  buyPrice: number
  sellAt: string
  sellPrice: number
  spread: number
  spreadPercent: number
  spreadBps: number
  volume24h: number
  signal: string
  timestamp: number
}

interface ArbitrageData {
  opportunities: Opportunity[]
  summary: {
    total: number
    cexFutures: number
    dexCex: number
    funding: number
  }
  timestamp: number
}

const OPP_COLUMNS = [
  { key: 'type' },
  { key: 'symbol' },
  { key: 'buyAt' },
  { key: 'buyPrice' },
  { key: 'sellAt' },
  { key: 'sellPrice' },
  // Rendered Spread cell prefers bps and falls back to percent — mirror that for sort/filter.
  { key: 'spread', accessor: (o: Opportunity) => (o.spreadBps > 0 ? o.spreadBps : o.spreadPercent) },
  { key: 'signal' },
]

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

export default function ArbitragePage() {
  const [data, setData] = useState<ArbitrageData | null>(null)
  const [connected, setConnected] = useState(false)
  const [filter, setFilter] = useState<'all' | 'CEX Spot-Futures' | 'DEX-CEX' | 'Funding Arb'>('all')
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io('https://tracker-ws.aitradepulse.com/arbitrage', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: Infinity,
    })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', () => setConnected(false))

    socket.on('arbitrage', (d: ArbitrageData) => {
      setData(d)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const opps = data?.opportunities ?? []
  const filtered = filter === 'all' ? opps : opps.filter(o => o.type === filter)
  const summary = data?.summary ?? { total: 0, cexFutures: 0, dexCex: 0, funding: 0 }
  const tc = useTableControls(filtered, OPP_COLUMNS)

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-accent-amber">⚡</span> Arbitrage Scanner
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              {connected ? '🟢 WebSocket connected — sub-second arbitrage detection' : '🔴 Connecting...'}
              {' • '}CEX spot-vs-futures + DEX-vs-CEX + Funding rate arb
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-teal-vivid">{summary.total} opportunities</span>
            <LiveDot status={connected ? 'live' : 'error'} label />
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-5 gap-2">
          <KPI label="Total" value={String(summary.total)} color="text-data-bull" />
          <KPI label="CEX Futures" value={String(summary.cexFutures)} />
          <KPI label="DEX vs CEX" value={String(summary.dexCex)} />
          <KPI label="Funding Arb" value={String(summary.funding)} />
          <KPI label="Status" value={connected ? 'LIVE' : 'OFFLINE'} color={connected ? 'text-data-bull' : 'text-data-bear'} />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-1">
          {(['all', 'CEX Spot-Futures', 'DEX-CEX', 'Funding Arb'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 text-[10px] font-mono rounded transition-colors ${filter === f ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary bg-bg-raised'}`}>
              {f === 'all' ? 'ALL' : f}
            </button>
          ))}
        </div>

        {/* Opportunities */}
        <Panel title="Live Arbitrage Opportunities" subtitle={`${tc.visible.length} active | Auto-updates via WebSocket`} liveStatus={connected ? 'live' : 'stale'}>
          <TableControlsBar idPrefix="arbitrage" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
          <div className="overflow-auto scrollbar-thin">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-text-muted">
                  <SortableTh controls={tc} k="type" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Type</SortableTh>
                  <SortableTh controls={tc} k="symbol" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Pair</SortableTh>
                  <SortableTh controls={tc} k="buyAt" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Buy At</SortableTh>
                  <SortableTh controls={tc} k="buyPrice" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Buy Price</SortableTh>
                  <SortableTh controls={tc} k="sellAt" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Sell At</SortableTh>
                  <SortableTh controls={tc} k="sellPrice" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Sell Price</SortableTh>
                  <SortableTh controls={tc} k="spread" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Spread</SortableTh>
                  <SortableTh controls={tc} k="signal" className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-center">Signal</SortableTh>
                </tr>
              </thead>
              <tbody>
                {tc.visible.map((o, i) => (
                  <tr key={`${o.symbol}-${o.type}-${i}`} className="border-b border-bg-border/30 hover:bg-bg-raised transition-colors">
                    <td className="px-3 py-1.5">
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        o.type === 'CEX Spot-Futures' ? 'bg-teal-vivid/20 text-teal-vivid' :
                        o.type === 'DEX-CEX' ? 'bg-accent-amber/20 text-accent-amber' :
                        'bg-purple-400/20 text-purple-400'
                      }`}>
                        {o.type}
                      </span>
                    </td>
                    <td className="text-[12px] font-mono px-3 py-1.5 font-bold text-text-primary">{o.symbol}</td>
                    <td className="text-[10px] font-mono px-3 py-1.5 text-data-bull">{o.buyAt}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-data-bull tabular-nums">${o.buyPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="text-[10px] font-mono px-3 py-1.5 text-data-bear">{o.sellAt}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right text-data-bear tabular-nums">${o.sellPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="text-[11px] font-mono px-3 py-1.5 text-right font-bold text-text-primary tabular-nums">
                      {o.spreadBps > 0 ? `${o.spreadBps.toFixed(1)} bps` : o.spreadPercent > 0 ? `${o.spreadPercent.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className="text-[9px] font-mono font-bold text-accent-amber">{o.signal}</span>
                    </td>
                  </tr>
                ))}
                {tc.visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-text-muted text-[11px] font-mono">
                      {connected ? 'Scanning for arbitrage opportunities...' : 'Connecting to WebSocket...'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}
