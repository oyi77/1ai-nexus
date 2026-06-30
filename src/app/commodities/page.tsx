"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

// Comprehensive commodity futures list (Yahoo Finance symbols)
const COMMODITY_GROUPS = [
  {
    category: 'Precious Metals',
    items: [
      { symbol: 'GC=F', name: 'Gold', unit: '$/oz' },
      { symbol: 'SI=F', name: 'Silver', unit: '$/oz' },
      { symbol: 'PL=F', name: 'Platinum', unit: '$/oz' },
      { symbol: 'PA=F', name: 'Palladium', unit: '$/oz' },
    ],
  },
  {
    category: 'Energy',
    items: [
      { symbol: 'CL=F', name: 'WTI Crude Oil', unit: '$/bbl' },
      { symbol: 'BZ=F', name: 'Brent Crude', unit: '$/bbl' },
      { symbol: 'NG=F', name: 'Natural Gas', unit: '$/MMBtu' },
      { symbol: 'HO=F', name: 'Heating Oil', unit: '$/gal' },
      { symbol: 'RB=F', name: 'RBOB Gasoline', unit: '$/gal' },
    ],
  },
  {
    category: 'Industrial Metals',
    items: [
      { symbol: 'HG=F', name: 'Copper', unit: '$/lb' },
    ],
  },
  {
    category: 'Agriculture',
    items: [
      { symbol: 'ZC=F', name: 'Corn', unit: '$/bu' },
      { symbol: 'ZW=F', name: 'Wheat', unit: '$/bu' },
      { symbol: 'ZS=F', name: 'Soybeans', unit: '$/bu' },
      { symbol: 'KC=F', name: 'Coffee', unit: '$/lb' },
      { symbol: 'SB=F', name: 'Sugar', unit: '$/lb' },
      { symbol: 'CT=F', name: 'Cotton', unit: '$/lb' },
      { symbol: 'CC=F', name: 'Cocoa', unit: '$/mt' },
    ],
  },
  {
    category: 'Livestock',
    items: [
      { symbol: 'LE=F', name: 'Live Cattle', unit: '$/lb' },
      { symbol: 'HE=F', name: 'Lean Hogs', unit: '$/lb' },
    ],
  },
]

const ALL_COMMODITIES = COMMODITY_GROUPS.flatMap(g => g.items)

interface Quote {
  price: number
  change: number
  changePct: number
  prevClose: number
}

export default function CommoditiesPage() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/commodities`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, Quote> = {}
        for (const q of d.data?.commodities ?? []) {
          map[q.symbol] = {
            price: q.price,
            change: q.change,
            changePct: q.changePercent,
            prevClose: q.prevClose,
          }
        }
        setQuotes(map)
        setLoading(false)
      })
      .catch((err) => { setLoading(false); setError((err as Error).message) })
  }, [])

  // Summary stats
  const quotedItems = ALL_COMMODITIES.filter(c => quotes[c.symbol])
  const biggestGainer = quotedItems.reduce((best, c) => {
    const pct = quotes[c.symbol]?.changePct ?? -Infinity
    return pct > (quotes[best.symbol]?.changePct ?? -Infinity) ? c : best
  }, quotedItems[0])
  const biggestLoser = quotedItems.reduce((worst, c) => {
    const pct = quotes[c.symbol]?.changePct ?? Infinity
    return pct < (quotes[worst.symbol]?.changePct ?? Infinity) ? c : worst
  }, quotedItems[0])

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">GLOBAL COMMODITIES</h1>
          <span className="text-[10px] text-text-muted font-mono">{quotedItems.length}/{ALL_COMMODITIES.length} live</span>
        </div>
        {error && <div className="text-data-bear text-[11px] font-mono p-4">Error: {error}</div>}

        {/* Summary bar */}
        {!loading && quotedItems.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">BIGGEST GAINER</p>
              <p className="text-sm font-mono font-bold text-accent-green">{biggestGainer?.name}</p>
              <p className="text-xs font-mono text-accent-green">
                +{quotes[biggestGainer?.symbol]?.changePct?.toFixed(2)}%
              </p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">BIGGEST LOSER</p>
              <p className="text-sm font-mono font-bold text-accent-red">{biggestLoser?.name}</p>
              <p className="text-xs font-mono text-accent-red">
                {quotes[biggestLoser?.symbol]?.changePct?.toFixed(2)}%
              </p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">GOLD</p>
              <p className="text-sm font-mono font-bold">${quotes['GC=F']?.price?.toFixed(0) ?? '—'}</p>
              <p className={`text-xs font-mono ${(quotes['GC=F']?.changePct ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {quotes['GC=F']?.changePct != null ? `${quotes['GC=F'].changePct >= 0 ? '+' : ''}${quotes['GC=F'].changePct.toFixed(2)}%` : '—'}
              </p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted">BRENT CRUDE</p>
              <p className="text-sm font-mono font-bold">${quotes['BZ=F']?.price?.toFixed(2) ?? '—'}</p>
              <p className={`text-xs font-mono ${(quotes['BZ=F']?.changePct ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {quotes['BZ=F']?.changePct != null ? `${quotes['BZ=F'].changePct >= 0 ? '+' : ''}${quotes['BZ=F'].changePct.toFixed(2)}%` : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Commodity groups */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading Yahoo Finance commodity data...</div>
        ) : (
          COMMODITY_GROUPS.map(group => (
            <div key={group.category} className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h2 className="text-xs font-mono text-accent-cyan mb-3">{group.category.toUpperCase()}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.items.map(c => {
                  const q = quotes[c.symbol]
                  if (!q) return (
                    <div key={c.symbol} className="p-3 border border-border-dim/30 rounded">
                      <p className="text-[10px] text-text-muted">{c.name}</p>
                      <p className="text-lg font-mono text-text-dim">—</p>
                      <p className="text-[10px] text-text-muted">{c.symbol}</p>
                    </div>
                  )
                  return (
                    <div key={c.symbol} className="p-3 border border-border-dim/30 rounded hover:bg-bg-elevated transition-colors">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-text-muted">{c.name}</p>
                        <span className="text-[10px] text-text-dim">{c.unit}</span>
                      </div>
                      <p className="text-xl font-mono font-bold text-text-primary">
                        ${q.price?.toFixed(2) ?? '—'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs font-mono ${(q.changePct ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {q.changePct != null ? `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%` : '—'}
                        </span>
                        <span className={`text-[10px] font-mono ${(q.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          ({q.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}` : '—'})
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            Yahoo Finance RE — Futures data for {ALL_COMMODITIES.length} commodity contracts.
            Covers precious metals, energy, industrial metals, agriculture, and livestock.
            Prices are delayed ~15min from real-time futures markets.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
