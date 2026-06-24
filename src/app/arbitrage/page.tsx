"use client"

import { useState, useEffect, useRef } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Opportunity {
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
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let mounted = true
    let reconnectTimeout: NodeJS.Timeout

    const connect = () => {
      const ws = new WebSocket('wss://tracker-ws.aitradepulse.com/socket.io/?EIO=4&transport=websocket')
      wsRef.current = ws

      ws.onopen = () => {
        if (mounted) setConnected(true)
        ws.send('42/arbitrage,["subscribe","all"]')
      }

      ws.onmessage = (event) => {
        try {
          const raw = event.data as string
          if (raw.startsWith('42/arbitrage,')) {
            const payload = JSON.parse(raw.slice('42/arbitrage,'.length))
            if (Array.isArray(payload) && payload[0] === 'arbitrage') {
              if (mounted) setData(payload[1] as ArbitrageData)
            }
          }
        } catch {}
      }

      ws.onerror = () => { if (mounted) setConnected(false) }
      ws.onclose = () => {
        if (mounted) setConnected(false)
        reconnectTimeout = setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      mounted = false
      clearTimeout(reconnectTimeout)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const opps = data?.opportunities ?? []
  const filtered = filter === 'all' ? opps : opps.filter(o => o.type === filter)
  const summary = data?.summary ?? { total: 0, cexFutures: 0, dexCex: 0, funding: 0 }

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
        <Panel title="Live Arbitrage Opportunities" subtitle={`${filtered.length} active | Auto-updates via WebSocket`} liveStatus={connected ? 'live' : 'stale'}>
          <div className="overflow-auto scrollbar-thin">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-text-muted">
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Type</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Pair</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Buy At</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Buy Price</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Sell At</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Sell Price</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Spread</th>
                  <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-center">Signal</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o, i) => (
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
                {filtered.length === 0 && (
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
