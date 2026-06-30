"use client"

import { useMemo, useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

// ─── Data types ───────────────────────────────────────────

interface MarketResponse { tickers: Array<{ symbol: string; price: string; change: string; positive: boolean }> }
interface MacroResponse { indicators: Array<{ id: string; name: string; latestValue: number; changePercent: number }> }
interface ForexResponse { rates: Record<string, number> }
interface CommoditiesResponse { commodities: Array<{ symbol: string; price: number; changePercent: number }> }
interface EquitiesResponse { indices: Array<{ symbol: string; price: number; changePercent: number }> }

interface Asset {
  name: string
  symbol: string
  price: number
  change: number
  category: string
}

const FOREX_PAIRS: Record<string, string> = {
  EUR: 'EUR/USD', GBP: 'GBP/USD', JPY: 'USD/JPY', CHF: 'USD/CHF',
  CNY: 'USD/CNY', AUD: 'AUD/USD', CAD: 'USD/CAD', SGD: 'USD/SGD',
  IDR: 'USD/IDR', KRW: 'USD/KRW', THB: 'USD/THB', MYR: 'USD/MYR',
}

const COMMODITY_SYMBOLS: Record<string, string> = {
  'GC=F': 'Gold', 'SI=F': 'Silver', 'CL=F': 'WTI Crude',
  'BZ=F': 'Brent Crude', 'HG=F': 'Copper', 'NG=F': 'Nat Gas',
}

const EQUITY_INDICES: Record<string, string> = {
  '^GSPC': 'S&P 500', '^IXIC': 'NASDAQ', '^DJI': 'Dow Jones',
  '^VIX': 'VIX', '^FTSE': 'FTSE 100', '^N225': 'Nikkei 225',
  '^HSI': 'Hang Seng',
}

export default function ComparePage() {
  const { data: market, status } = useLiveFetch<MarketResponse>({ url: '/api/v1/market/prices', interval: 60_000 })
  const { data: macro } = useLiveFetch<MacroResponse>({ url: '/api/v1/macro', interval: 300_000 })
  const { data: forexData } = useLiveFetch<ForexResponse>({ url: '/api/v1/forex?base=USD', interval: 300_000 })
  const { data: commodityData } = useLiveFetch<CommoditiesResponse>({ url: '/api/v1/commodities', interval: 60_000 })
  const { data: indexData } = useLiveFetch<EquitiesResponse>({
    url: `/api/v1/equities?symbols=${Object.keys(EQUITY_INDICES).join(',')}`,
    interval: 60_000,
  })

  const [filter, setFilter] = useState<string>('all')

  const assets: Asset[] = useMemo(() => {
    const result: Asset[] = []

    // Crypto
    for (const t of market?.tickers ?? []) {
      result.push({
        name: t.symbol,
        symbol: t.symbol,
        price: parseFloat((t.price || '0').replace(/[$,]/g, '')),
        change: parseFloat((t.change || '0').replace(/%+/g, '')),
        category: 'Crypto',
      })
    }

    // Macro indicators
    for (const i of macro?.indicators ?? []) {
      result.push({
        name: i.name,
        symbol: i.id,
        price: i.latestValue,
        change: i.changePercent || 0,
        category: 'Macro',
      })
    }

    // Forex
    const rates = forexData?.rates
    if (rates) {
      for (const [code, pair] of Object.entries(FOREX_PAIRS)) {
        const rate = rates[code]
        if (rate) {
          result.push({
            name: pair,
            symbol: pair,
            price: rate,
            change: 0,
            category: 'Forex',
          })
        }
      }
    }

    // Commodities
    for (const q of commodityData?.commodities ?? []) {
      const name = COMMODITY_SYMBOLS[q.symbol] ?? q.symbol
      result.push({
        name,
        symbol: q.symbol,
        price: q.price,
        change: q.changePercent ?? 0,
        category: 'Commodities',
      })
    }

    // Equity indices
    for (const q of indexData?.indices ?? []) {
      const name = EQUITY_INDICES[q.symbol] ?? q.symbol
      result.push({
        name,
        symbol: q.symbol,
        price: q.price,
        change: q.changePercent ?? 0,
        category: 'Indices',
      })
    }

    return result
  }, [market, macro, forexData, commodityData, indexData])

  const categories = useMemo(() => {
    const cats = [...new Set(assets.map(a => a.category))]
    return ['all', ...cats]
  }, [assets])

  const filtered = filter === 'all' ? assets : assets.filter(a => a.category === filter)

  const columns: Column<Asset>[] = [
    { key: 'category', header: 'Category', width: 80, render: r => {
      const colors: Record<string, string> = {
        Crypto: 'text-teal-vivid', Macro: 'text-data-purple', Forex: 'text-data-info',
        Commodities: 'text-accent-amber', Indices: 'text-accent-green',
      }
      return <span className={`text-[10px] font-mono ${colors[r.category] || 'text-text-muted'}`}>{r.category}</span>
    }},
    { key: 'name', header: 'Asset', width: 160, render: r => <span className="text-text-primary font-medium">{r.name}</span> },
    { key: 'symbol', header: 'Symbol', width: 80, render: r => <span className="text-text-dim text-[10px] font-mono">{r.symbol}</span> },
    { key: 'price', header: 'Value', width: 100, align: 'right', render: r => <PriceTag value={r.price} size="sm" /> },
    { key: 'change', header: 'Change', width: 70, align: 'right', render: r => r.change !== 0 ? <DeltaBadge value={r.change} size="xs" /> : <span className="text-text-muted text-[10px]">—</span> },
  ]

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of assets) counts[a.category] = (counts[a.category] ?? 0) + 1
    return counts
  }, [assets])

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Cross-Market Compare</h1>
            <p className="text-[11px] text-text-muted font-mono">
              {assets.length} assets across {Object.keys(categoryCounts).length} markets — Crypto, Forex, Commodities, Indices, Macro
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-1.5">
          {categories.map(cat => (
            <button key={cat} onClick={() => setFilter(cat)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded capitalize ${
                filter === cat ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'
              }`}>
              {cat} {cat !== 'all' ? `(${categoryCounts[cat] ?? 0})` : `(${assets.length})`}
            </button>
          ))}
        </div>

        <Panel title="All Markets" subtitle={`${filtered.length} assets`} liveStatus={status} maxHeight={700}>
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={filtered as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={28}
            emptyState={<div className="text-text-muted text-[11px] p-4">Loading cross-market data...</div>}
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
