"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { Sparkline } from '@/components/primitives/Sparkline'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Token {
  symbol: string
  name: string
  price: number
  change24h: number
  change7d: number
  volume: number
  marketCap: number
  holders: number
  riskScore: number | null
  sparkline: number[]
  chain: string
  [key: string]: unknown
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'volume' | 'price' | 'change'>('volume')

  const fetchTokens = useCallback(async () => {
    try {
      const [derivativesRes, exchangesRes] = await Promise.allSettled([
        fetch('/api/v1/derivatives?limit=50').then(r => r.json()),
        fetch('/api/v1/exchanges?limit=50').then(r => r.json()),
      ])

      const tokenMap = new Map<string, Token>()

      // From derivatives (Binance Futures)
      if (derivativesRes.status === 'fulfilled' && derivativesRes.value?.data?.topPairs) {
        for (const p of derivativesRes.value.data.topPairs) {
          const symbol = (p.symbol as string).replace('USDT', '')
          tokenMap.set(symbol, {
            symbol,
            name: symbol,
            price: p.price as number,
            change24h: p.priceChange24h as number,
            change7d: 0,
            volume: p.quoteVolume24h as number,
            marketCap: 0,
            holders: 0,
            riskScore: null,
            sparkline: [],
            chain: 'Multi',
          })
        }
      }

      // From exchanges
      if (exchangesRes.status === 'fulfilled' && exchangesRes.value?.data?.binance) {
        for (const t of exchangesRes.value.data.binance) {
          const symbol = (t.symbol as string).replace('USDT', '')
          if (!tokenMap.has(symbol)) {
            tokenMap.set(symbol, {
              symbol,
              name: symbol,
              price: t.price as number,
              change24h: t.priceChange24h as number,
              change7d: 0,
              volume: t.volume24h as number,
              marketCap: 0,
              holders: 0,
              riskScore: null,
              sparkline: [],
              chain: 'Multi',
            })
          }
        }
      }

      setTokens(Array.from(tokenMap.values()))
      setFeedStatus('live')
    } catch {
      setFeedStatus('error')
    }
  }, [])

  useEffect(() => {
    const invoke = () => fetchTokens()
    invoke()
    const interval = setInterval(fetchTokens, 30_000)
    return () => clearInterval(interval)
  }, [fetchTokens])

  const filtered = tokens
    .filter(t => !search || t.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'volume') return b.volume - a.volume
      if (sortBy === 'price') return b.price - a.price
      return b.change24h - a.change24h
    })

  const columns: Column<Token>[] = [
    {
      key: 'symbol',
      header: 'Token',
      width: 80,
      render: (row) => (
        <button
          onClick={() => setSelectedToken(row)}
          className="text-teal-vivid font-bold hover:underline cursor-pointer"
        >
          {row.symbol}
        </button>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: 100,
      align: 'right',
      render: (row) => <PriceTag value={row.price} size="sm" />,
    },
    {
      key: 'change24h',
      header: '24h%',
      width: 70,
      align: 'right',
      render: (row) => <DeltaBadge value={row.change24h} size="xs" />,
    },
    {
      key: 'volume',
      header: 'Volume 24h',
      width: 100,
      align: 'right',
      render: (row) => <span className="text-text-secondary">${(row.volume / 1e6).toFixed(1)}M</span>,
    },
    {
      key: 'marketCap',
      header: 'MCap',
      width: 100,
      align: 'right',
      render: (row) => <span className="text-text-muted">{row.marketCap > 0 ? `$${(row.marketCap / 1e9).toFixed(2)}B` : '—'}</span>,
    },
    {
      key: 'holders',
      header: 'Holders',
      width: 70,
      align: 'right',
      render: (row) => <span className="text-text-muted">{row.holders > 0 ? row.holders.toLocaleString() : '—'}</span>,
    },
    {
      key: 'riskScore',
      header: 'Risk',
      width: 50,
      align: 'right',
      render: (row) => (
        <span className={`font-mono ${row.riskScore == null ? 'text-text-muted' : row.riskScore > 70 ? 'text-data-bear' : row.riskScore > 40 ? 'text-data-warn' : 'text-data-bull'}`}>
          {row.riskScore != null ? row.riskScore : '—'}
        </span>
      ),
    },
    {
      key: 'sparkline',
      header: '7d',
      width: 60,
      render: (row) => <Sparkline data={row.sparkline} width={50} height={16} />,
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Token Intelligence</h1>
            <p className="text-[11px] text-text-muted font-mono">Per-token deep dive — price, liquidity, holders, signals</p>
          </div>
          <LiveDot status={feedStatus} label />
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search token..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-bg-panel border border-bg-border rounded px-3 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted outline-none w-48"
          />
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-text-muted">Sort:</span>
            {(['volume', 'price', 'change'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-2 py-1 rounded ${sortBy === s ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px] text-text-muted font-mono">{filtered.length} tokens</span>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
          {/* Token List */}
          <div className="lg:col-span-2">
            <Panel
              title="Token List"
              subtitle="Sorted by volume"
              liveStatus={feedStatus}
              onRefresh={fetchTokens}
              maxHeight={600}
            >
              <DataTable
                columns={columns}
                data={filtered}
                sortable
                rowHeight={28}
                onRowClick={(row) => setSelectedToken(row)}
                emptyState={<div className="text-text-muted text-[11px] p-4">Loading tokens...</div>}
              />
            </Panel>
          </div>

          {/* Token Detail */}
          <Panel
            title={selectedToken ? `${selectedToken.symbol} Detail` : 'Token Detail'}
            subtitle="Select a token to view details"
            liveStatus={feedStatus}
            maxHeight={600}
          >
            {selectedToken ? (
              <div className="p-3 space-y-4">
                {/* Price Header */}
                <div className="text-center">
                  <div className="text-[28px] font-head font-bold text-text-primary">
                    <PriceTag value={selectedToken.price} size="lg" />
                  </div>
                  <DeltaBadge value={selectedToken.change24h} size="md" />
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Volume 24h', value: `$${(selectedToken.volume / 1e6).toFixed(1)}M` },
                    { label: 'Market Cap', value: selectedToken.marketCap > 0 ? `$${(selectedToken.marketCap / 1e9).toFixed(2)}B` : 'N/A' },
                    { label: 'Holders', value: selectedToken.holders > 0 ? selectedToken.holders.toLocaleString() : 'N/A' },
                    { label: 'Risk Score', value: String(selectedToken.riskScore) },
                    { label: 'Chain', value: selectedToken.chain },
                    { label: '7d Change', value: `${selectedToken.change7d.toFixed(2)}%` },
                  ].map((stat, i) => (
                    <div key={i} className="bg-bg-raised rounded p-2">
                      <div className="text-[9px] text-text-muted font-mono uppercase">{stat.label}</div>
                      <div className="text-[12px] font-mono text-text-primary">{stat.value}</div>
                    </div>
                  ))}
                </div>

                {/* Sparkline */}
                <div className="bg-bg-raised rounded p-3">
                  <div className="text-[10px] text-text-muted font-mono mb-2">7D PRICE ACTION</div>
                  <Sparkline data={selectedToken.sparkline} width={240} height={60} />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-[11px]">
                Select a token from the list
              </div>
            )}
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
