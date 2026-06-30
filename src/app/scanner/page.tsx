"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { LiveDot } from '@/components/primitives/LiveDot'

interface NewPair {
  address: string
  name: string
  priceUsd: number
  fdv: number
  liquidity: number
  ageMinutes: number
  volume5m: number
  buys5m: number
  sells5m: number
  rugRisk: string
  riskScore: number
  network: string
  [key: string]: unknown
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${(n ?? 0).toFixed(0)}`
}

export function DegenScannerPageContent() {
  return <DegenScannerPageInner />
}

export default function DegenScannerPage() {
  return <NexusLayout><DegenScannerPageInner /></NexusLayout>
}

function DegenScannerPageInner() {
  const [pairs, setPairs] = useState<NewPair[]>([])
  const [network, setNetwork] = useState('solana')
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const wsReconnectRef = useRef<NodeJS.Timeout | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/dex/new-pairs?network=${network}`)
      const data = await res.json()
      
      if (Array.isArray(data.data?.items)) {
        setPairs(data.data.items.map((p: Record<string, unknown>) => ({
          address: String(p.address ?? ''),
          name: String(p.name ?? ''),
          priceUsd: Number(p.priceUsd ?? 0),
          fdv: Number(p.fdv ?? 0),
          liquidity: Number(p.liquidity ?? 0),
          ageMinutes: Number(p.ageMinutes ?? 0),
          volume5m: Number(p.volume5m ?? 0),
          buys5m: Number(p.buys5m ?? 0),
          sells5m: Number(p.sells5m ?? 0),
          rugRisk: String(p.rugRisk ?? 'Unknown'),
          riskScore: Number(p.riskScore ?? 50),
          network: String(p.network ?? network),
        })))
        setFeedStatus('live')
        setLastUpdated(new Date())
      } else {
        setFeedStatus('error')
      }
    } catch {
      setFeedStatus('error')
    }
  }, [network])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000) // Fast 10s polling for sniper
    return () => clearInterval(interval)
  }, [fetchData])

  // Real-time WebSocket connection to /dexscreener + /memecoins namespaces
  useEffect(() => {
    let mounted = true
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://tracker-ws.aitradepulse.com'

    const connect = () => {
      try {
        const ws = new WebSocket(`${WS_URL}/socket.io/?EIO=4&transport=websocket`)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mounted) return
          setWsConnected(true)
          ws.send('40/dexscreener')
          ws.send('40/memecoins')
        }

        ws.onmessage = (event) => {
          if (!mounted) return
          const raw = event.data as string

          // /dexscreener namespace (boost events with enriched metadata)
          if (raw.startsWith('42/dexscreener,')) {
            try {
              const payload = JSON.parse(raw.slice('42/dexscreener,'.length))
              const ev = payload[0] as string
              const d = payload[1] as Record<string, unknown>
              if (ev !== 'boost' && ev !== 'token_update') return

              setPairs(prev => {
                const addr = String(d.address ?? '')
                const existing = prev.find(p => p.address === addr)
                const np: NewPair = {
                  address: addr,
                  name: String(d.name ?? 'Unknown'),
                  priceUsd: Number(d.priceUsd ?? 0),
                  fdv: Number(d.fdv ?? 0),
                  liquidity: Number(d.liquidity ?? 0),
                  ageMinutes: Math.round(Number(d.age ?? 0) / 60),
                  volume5m: Number(d.volume24h ?? 0) / 288,
                  buys5m: 0, sells5m: 0,
                  rugRisk: String(d.risk ?? 'medium'),
                  riskScore: Number(d.score ?? 50),
                  network: String(d.chain ?? 'solana'),
                }
                if (existing) return prev.map(p => p.address === addr ? { ...p, ...np } : p)
                return [np, ...prev].slice(0, 100)
              })
              setFeedStatus('live')
              setLastUpdated(new Date())
            } catch { /* ignore parse errors */ }
          }

          // /memecoins namespace (new_token creation events)
          if (raw.startsWith('42/memecoins,')) {
            try {
              const payload = JSON.parse(raw.slice('42/memecoins,'.length))
              const ev = payload[0] as string
              const d = payload[1] as Record<string, unknown>
              if (ev !== 'new_token' && ev !== 'token_update') return

              const scored = (d.scored as Record<string, unknown>) ?? d
              const addr = String(scored.address ?? '')
              setPairs(prev => {
                const existing = prev.find(p => p.address === addr)
                const np: NewPair = {
                  address: addr,
                  name: `NEW ${String(scored.name ?? 'New Token')}`,
                  priceUsd: Number(scored.priceUsd ?? 0),
                  fdv: Number(scored.fdv ?? 0),
                  liquidity: Number(scored.liquidity ?? 0),
                  ageMinutes: Math.round(Number(scored.age ?? 0) / 60),
                  volume5m: Number(scored.volume24h ?? 0) / 288,
                  buys5m: 0, sells5m: 0,
                  rugRisk: String(scored.risk ?? 'extreme'),
                  riskScore: Number(scored.score ?? 50),
                  network: String(scored.chain ?? 'solana'),
                }
                if (existing) return prev.map(p => p.address === addr ? { ...p, ...np } : p)
                return [np, ...prev].slice(0, 100)
              })
            } catch { /* ignore parse errors */ }
          }
        }

        ws.onclose = () => {
          if (!mounted) return
          setWsConnected(false)
          wsReconnectRef.current = setTimeout(connect, 3000)
        }
        ws.onerror = () => { if (mounted) setWsConnected(false) }
      } catch { /* connection error */ }
    }

    connect()
    return () => {
      mounted = false
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const columns: Column<NewPair>[] = [
    { key: 'name', header: 'Token Pair', width: 200, render: r => (
      <div className="flex flex-col">
        <span className="text-teal-vivid font-bold text-[12px] truncate">{r.name}</span>
        <span className="text-text-muted font-mono text-[9px]">{r.address}</span>
      </div>
    )},
    { key: 'ageMinutes', header: 'Age', width: 80, align: 'right', render: r => (
      <span className={`font-mono text-[11px] ${r.ageMinutes < 15 ? 'text-data-bull font-bold animate-pulse' : 'text-text-primary'}`}>
        {r.ageMinutes}m
      </span>
    )},
    { key: 'liquidity', header: 'Liquidity', width: 100, align: 'right', render: r => (
      <span className={`font-mono text-[11px] ${r.liquidity < 5000 ? 'text-data-bear' : 'text-text-primary'}`}>
        {fmtUsd(r.liquidity)}
      </span>
    )},
    { key: 'fdv', header: 'FDV', width: 100, align: 'right', render: r => (
      <span className="font-mono text-[11px] text-text-secondary">{fmtUsd(r.fdv)}</span>
    )},
    { key: 'txs', header: 'TXs (5m)', width: 100, align: 'right', render: r => (
      <div className="flex items-center justify-end space-x-2 text-[10px] font-mono">
        <span className="text-data-bull">{r.buys5m} B</span>
        <span className="text-text-muted">/</span>
        <span className="text-data-bear">{r.sells5m} S</span>
      </div>
    )},
    { key: 'rugRisk', header: 'Rug Risk', width: 100, align: 'right', render: r => (
      <div className="flex items-center justify-end gap-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
          r.rugRisk === 'High' ? 'bg-data-bear/20 text-data-bear' : 
          r.rugRisk === 'Low' ? 'bg-data-bull/20 text-data-bull' : 
          'bg-accent-amber/20 text-accent-amber'
        }`}>
          {r.rugRisk}
        </span>
      </div>
    )},
    { key: 'actions', header: '', width: 80, align: 'right', render: r => (
      <a 
        href={`https://dexscreener.com/${network}/${r.address}`} 
        target="_blank" 
        rel="noopener noreferrer"
        className="px-2 py-1 bg-teal-vivid/10 text-teal-vivid hover:bg-teal-vivid hover:text-bg-base transition-colors rounded text-[10px] font-bold uppercase tracking-wider"
      >
        Snipe
      </a>
    )}
  ]

  return (
    <>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">⚡</span> GMGN Degen Sniper
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              {wsConnected ? '🟢 Real-time WS' : '🔴 REST polling'} — Live monitoring of newly created liquidity pools. Extreme volatility warning.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-bg-raised p-1 rounded">
              {['solana', 'base', 'ethereum'].map(n => (
                <button
                  key={n}
                  onClick={() => setNetwork(n)}
                  className={`px-3 py-1 text-[11px] font-mono rounded uppercase transition-colors ${network === n ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-bg-panel px-3 py-1.5 border border-bg-border rounded">
              <LiveDot status={feedStatus} />
              <span className="text-[10px] font-mono text-text-muted">Updated {lastUpdated.toLocaleTimeString()}</span>
            </div>
          </div>
        </div>

        {/* Global Stats Strip */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-bg-panel border border-bg-border p-3 rounded">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">New Pairs (Last 15m)</div>
            <div className="text-[20px] font-mono font-bold text-teal-vivid">{pairs.filter(p => p.ageMinutes < 15).length}</div>
          </div>
          <div className="bg-bg-panel border border-bg-border p-3 rounded">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">High Risk (Honeypots)</div>
            <div className="text-[20px] font-mono font-bold text-data-bear">{pairs.filter(p => p.rugRisk === 'High').length}</div>
          </div>
          <div className="bg-bg-panel border border-bg-border p-3 rounded">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Average Initial LP</div>
            <div className="text-[20px] font-mono font-bold text-text-primary">
              {fmtUsd(pairs.reduce((acc, p) => acc + p.liquidity, 0) / (pairs.length || 1))}
            </div>
          </div>
          <div className="bg-bg-panel border border-bg-border p-3 rounded">
            <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Active Network</div>
            <div className="text-[20px] font-mono font-bold text-text-primary capitalize">{network}</div>
          </div>
        </div>

        <Panel title="Live Pool Creation Feed" subtitle={`Showing ${pairs.length} youngest pairs`} liveStatus={feedStatus} onRefresh={fetchData}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={pairs as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={40}
            emptyState={<div className="text-text-muted text-[12px] p-8 text-center">Scanning blockchain for new pairs...</div>}
          />
        </Panel>
      </div>
    </>
  )
}
