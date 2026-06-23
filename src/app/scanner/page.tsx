"use client"

import { useState, useEffect, useCallback } from 'react'
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

export default function DegenScannerPage() {
  const [pairs, setPairs] = useState<NewPair[]>([])
  const [network, setNetwork] = useState('solana')
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/dex/new-pairs?network=${network}`)
      const data = await res.json()
      
      if (data.success && Array.isArray(data.data?.items)) {
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
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">⚡</span> GMGN Degen Sniper
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">Live monitoring of newly created liquidity pools. Extreme volatility warning.</p>
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
    </NexusLayout>
  )
}
