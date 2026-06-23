"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { Search, X, TrendingUp, TrendingDown, Eye, EyeOff } from 'lucide-react'

interface WatchItem {
  id: string
  symbol: string
  type: 'token' | 'wallet' | 'entity'
  address?: string
  addedAt: number
  alertAbove?: number
  alertBelow?: number
  notes?: string
}

interface TokenPrice {
  symbol: string
  price: number
  change24h: number
  volume24h: number
}

const STORAGE_KEY = 'nexus:watchlist'

function loadWatchlist(): WatchItem[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch { return [] }
}

function saveWatchlist(items: WatchItem[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([])
  const [prices, setPrices] = useState<Map<string, TokenPrice>>(new Map())
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [newSymbol, setNewSymbol] = useState('')
  const [filter, setFilter] = useState<'all' | 'token' | 'wallet' | 'entity'>('all')

  useEffect(() => {
    setItems(loadWatchlist())
  }, [])

  const fetchPrices = useCallback(async () => {
    if (items.length === 0) return
    try {
      const tokenItems = items.filter(i => i.type === 'token')
      if (tokenItems.length === 0) return

      const symbols = tokenItems.map(i => i.symbol.toUpperCase())
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbols.map(s => `"${s}USDT"`).join(',')}]`)
      if (!res.ok) return
      const data = (await res.json()) as Array<{
        symbol: string
        lastPrice: string
        priceChangePercent: string
        quoteVolume: string
      }>

      const newPrices = new Map<string, TokenPrice>()
      for (const d of data) {
        const sym = d.symbol.replace('USDT', '')
        newPrices.set(sym, {
          symbol: sym,
          price: parseFloat(d.lastPrice),
          change24h: parseFloat(d.priceChangePercent),
          volume24h: parseFloat(d.quoteVolume),
        })
      }
      setPrices(newPrices)
      setStatus('live')
    } catch {
      setStatus('error')
    }
  }, [items])

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 10_000)
    return () => clearInterval(id)
  }, [fetchPrices])

  const addItem = (type: 'token' | 'wallet' | 'entity', symbol: string, address?: string) => {
    if (!symbol.trim()) return
    const newItem: WatchItem = {
      id: `${type}-${symbol}-${Date.now()}`,
      symbol: symbol.toUpperCase().trim(),
      type,
      address,
      addedAt: Date.now(),
    }
    const updated = [newItem, ...items]
    setItems(updated)
    saveWatchlist(updated)
    setNewSymbol('')
  }

  const removeItem = (id: string) => {
    const updated = items.filter(i => i.id !== id)
    setItems(updated)
    saveWatchlist(updated)
  }

  const filtered = items.filter(i => {
    if (filter !== 'all' && i.type !== filter) return false
    if (search && !i.symbol.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const triggered = items.filter(i => {
    if (i.type !== 'token') return false
    const p = prices.get(i.symbol)
    if (!p) return false
    if (i.alertAbove && p.price > i.alertAbove) return true
    if (i.alertBelow && p.price < i.alertBelow) return true
    return false
  })

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">👁</span> Watchlist
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Track tokens, wallets, and entities. Set price alerts. Live data from Binance.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Add Item Bar */}
        <div className="bg-bg-panel border border-bg-border rounded p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-mono text-text-muted uppercase mb-1 block">Symbol / Address</label>
              <input
                type="text"
                value={newSymbol}
                onChange={e => setNewSymbol(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem('token', newSymbol) }}
                placeholder="BTC, ETH, SOL, or wallet address..."
                className="w-full bg-bg-raised border border-bg-border rounded px-3 py-2 text-[12px] font-mono text-text-primary placeholder:text-text-muted focus:border-teal-vivid focus:outline-none"
              />
            </div>
            <button
              onClick={() => addItem('token', newSymbol)}
              className="px-4 py-2 bg-teal-vivid text-bg-base rounded text-[11px] font-mono font-bold hover:bg-teal-vivid/80 transition-colors"
            >
              Add Token
            </button>
            <button
              onClick={() => addItem('wallet', newSymbol)}
              className="px-4 py-2 bg-bg-raised text-text-primary border border-bg-border rounded text-[11px] font-mono font-bold hover:border-teal-vivid transition-colors"
            >
              Add Wallet
            </button>
            <button
              onClick={() => addItem('entity', newSymbol)}
              className="px-4 py-2 bg-bg-raised text-text-primary border border-bg-border rounded text-[11px] font-mono font-bold hover:border-teal-vivid transition-colors"
            >
              Add Entity
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="Watching" value={String(items.length)} />
          <StatCard label="Tokens" value={String(items.filter(i => i.type === 'token').length)} />
          <StatCard label="Wallets" value={String(items.filter(i => i.type === 'wallet').length)} />
          <StatCard label="Alerts Triggered" value={String(triggered.length)} highlight={triggered.length > 0} />
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search watchlist..."
              className="w-full bg-bg-raised border border-bg-border rounded pl-7 pr-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-teal-vivid focus:outline-none"
            />
          </div>
          <div className="flex bg-bg-raised p-1 rounded">
            {(['all', 'token', 'wallet', 'entity'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-mono rounded uppercase transition-colors ${filter === f ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Watchlist Table */}
        <Panel title="Watchlist" subtitle={`${filtered.length} items`} liveStatus={status}>
          {filtered.length === 0 ? (
            <div className="p-8 text-text-muted text-[12px] font-mono text-center">
              {items.length === 0
                ? 'No items yet. Add a token, wallet, or entity above.'
                : 'No items match your filter.'}
            </div>
          ) : (
            <div className="overflow-auto scrollbar-thin">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-text-muted">
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left w-12">#</th>
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Symbol</th>
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-left w-16">Type</th>
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Price</th>
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">24h</th>
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right hidden sm:table-cell">Volume</th>
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Added</th>
                    <th className="text-[10px] font-mono uppercase px-3 py-2 border-b border-bg-border text-right w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => {
                    const p = item.type === 'token' ? prices.get(item.symbol) : null
                    return (
                      <tr key={item.id} className="border-b border-bg-border/30 hover:bg-bg-raised transition-colors">
                        <td className="text-[11px] font-mono px-3 py-2 text-text-muted">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {p && (p.change24h >= 0 ? <TrendingUp size={12} className="text-data-bull" /> : <TrendingDown size={12} className="text-data-bear" />)}
                            <span className="text-[12px] font-mono font-bold text-text-primary">{item.symbol}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            item.type === 'token' ? 'bg-teal-vivid/20 text-teal-vivid' :
                            item.type === 'wallet' ? 'bg-accent-amber/20 text-accent-amber' :
                            'bg-purple-400/20 text-purple-400'
                          }`}>
                            {item.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-[12px] font-mono px-3 py-2 text-right tabular-nums">
                          {p ? <PriceTag value={p.price} size="sm" /> : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="text-[11px] font-mono px-3 py-2 text-right">
                          {p ? <DeltaBadge value={p.change24h} size="xs" /> : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="text-[10px] font-mono px-3 py-2 text-right text-text-muted hidden sm:table-cell tabular-nums">
                          {p ? fmtUsd(p.volume24h) : '—'}
                        </td>
                        <td className="text-[10px] font-mono px-3 py-2 text-right text-text-muted tabular-nums">
                          {new Date(item.addedAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-text-muted hover:text-data-bear transition-colors"
                            title="Remove from watchlist"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Alerts */}
        {triggered.length > 0 && (
          <Panel title="⚠️ Alert Triggers" subtitle="Price alerts that have been hit" liveStatus="stale">
            <div className="p-3 space-y-2">
              {triggered.map(item => {
                const p = prices.get(item.symbol)
                return (
                  <div key={item.id} className="flex items-center justify-between bg-data-bear/10 border border-data-bear/30 p-3 rounded">
                    <div className="flex items-center gap-2">
                      <Eye size={14} className="text-data-bear" />
                      <span className="text-[12px] font-mono font-bold text-text-primary">{item.symbol}</span>
                      <span className="text-[10px] font-mono text-text-muted">
                        {item.alertAbove && p && p.price > item.alertAbove && `Above $${item.alertAbove.toLocaleString()}`}
                        {item.alertBelow && p && p.price < item.alertBelow && `Below $${item.alertBelow.toLocaleString()}`}
                      </span>
                    </div>
                    <span className="text-[14px] font-mono font-bold text-data-bear tabular-nums">
                      ${p?.price.toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          </Panel>
        )}
      </div>
    </NexusLayout>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-bg-panel border rounded p-3 ${highlight ? 'border-data-bear' : 'border-bg-border'}`}>
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[18px] font-head font-bold tabular-nums ${highlight ? 'text-data-bear' : 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}