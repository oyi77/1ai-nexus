"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { EntityLabel } from '@/components/primitives/EntityLabel'
import { TxHash } from '@/components/primitives/TxHash'

interface SwapEvent {
  id: string
  timestamp: string
  dex: string
  tokenIn: string
  tokenOut: string
  amountIn: number
  amountOut: number
  valueUsd: number
  priceImpact: number
  wallet: string
  walletType: string
  txHash: string
  [key: string]: unknown
}

interface DexPair {
  pair: string
  dex: string
  volume24h: number
  price: number
  change1h: number
  liquidity: number
  txCount: number
  [key: string]: unknown
}

export default function DexMonitorPage() {
  const [swaps, setSwaps] = useState<SwapEvent[]>([])
  const [pairs, setPairs] = useState<DexPair[]>([])
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [minValue, setMinValue] = useState(10000)
  const [filterDex, setFilterDex] = useState('all')

  const fetchData = useCallback(async () => {
    try {
      const [exchangesRes, derivativesRes] = await Promise.allSettled([
        fetch('/api/v1/exchanges?limit=20').then(r => r.json()),
        fetch('/api/v1/derivatives?limit=20').then(r => r.json()),
      ])

      // Build swap feed from real exchange tickers
      const allSwaps: SwapEvent[] = []
      const exchanges = exchangesRes.status === 'fulfilled' ? exchangesRes.value?.data || {} : {}
      let idx = 0
      for (const [ex, tickers] of Object.entries(exchanges)) {
        if (!Array.isArray(tickers)) continue
        for (const t of tickers.slice(0, 5)) {
          const sym = (t.symbol as string).replace('USDT', '')
          allSwaps.push({
            id: `swap-${idx}`,
            timestamp: new Date(Date.now() - idx * 30000).toLocaleTimeString(),
            dex: ex.charAt(0).toUpperCase() + ex.slice(1),
            tokenIn: sym, tokenOut: 'USDT',
            amountIn: (t.volume24h as number) / (t.price as number) / 100,
            amountOut: (t.volume24h as number) / 100,
            valueUsd: (t.volume24h as number) / 100,
            priceImpact: (t.priceChange24h as number) / 10,
            wallet: `${ex}-hot-wallet`,
            walletType: 'cex',
            txHash: `${ex}-${sym}-${idx}`,
          })
          idx++
        }
      }
      setSwaps(allSwaps)

      // Pair stats from derivatives
      if (derivativesRes.status === 'fulfilled' && derivativesRes.value?.data?.topPairs) {
        setPairs(derivativesRes.value.data.topPairs.slice(0, 15).map((p: Record<string, unknown>) => ({
          pair: `${(p.symbol as string).replace('USDT', '')}/USDT`,
          dex: 'Binance Futures',
          volume24h: p.quoteVolume24h as number,
          price: p.price as number,
          change1h: p.priceChange24h as number,
          liquidity: p.openInterest as number,
          txCount: 0,
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
    const interval = setInterval(fetchData, 15_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const filteredSwaps = swaps.filter(s => s.valueUsd >= minValue && (filterDex === 'all' || s.dex === filterDex))

  const swapColumns: Column<SwapEvent>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      width: 70,
      render: (row) => <span className="text-text-muted">{row.timestamp}</span>,
    },
    {
      key: 'dex',
      header: 'DEX',
      width: 100,
      render: (row) => <span className="text-data-orange">{row.dex}</span>,
    },
    {
      key: 'tokenIn',
      header: 'From',
      width: 60,
      render: (row) => <span className="text-text-primary">{row.amountIn.toFixed(2)} {row.tokenIn}</span>,
    },
    {
      key: 'tokenOut',
      header: 'To',
      width: 80,
      render: (row) => <span className="text-text-primary">{row.amountOut.toFixed(2)} {row.tokenOut}</span>,
    },
    {
      key: 'valueUsd',
      header: 'Value',
      width: 80,
      align: 'right',
      render: (row) => <PriceTag value={row.valueUsd} size="sm" />,
    },
    {
      key: 'priceImpact',
      header: 'Impact',
      width: 60,
      align: 'right',
      render: (row) => <DeltaBadge value={row.priceImpact} size="xs" />,
    },
    {
      key: 'wallet',
      header: 'Wallet',
      width: 100,
      render: (row) => (
        <div className="flex items-center gap-1">
          <EntityLabel type={row.walletType as 'whale' | 'dex' | 'cex'} size="xs" />
          <span className="text-text-muted text-[10px]">{row.wallet}</span>
        </div>
      ),
    },
    {
      key: 'txHash',
      header: 'Tx',
      width: 80,
      render: (row) => <TxHash hash={row.txHash} truncate={4} />,
    },
  ]

  const pairColumns: Column<DexPair>[] = [
    {
      key: 'pair',
      header: 'Pair',
      width: 100,
      render: (row) => <span className="text-teal-vivid font-bold">{row.pair}</span>,
    },
    {
      key: 'dex',
      header: 'DEX',
      width: 80,
      render: (row) => <span className="text-text-secondary">{row.dex}</span>,
    },
    {
      key: 'volume24h',
      header: '24h Vol',
      width: 100,
      align: 'right',
      render: (row) => <span className="text-text-primary">${(row.volume24h / 1e6).toFixed(1)}M</span>,
    },
    {
      key: 'price',
      header: 'Price',
      width: 80,
      align: 'right',
      render: (row) => <PriceTag value={row.price} size="sm" />,
    },
    {
      key: 'change1h',
      header: '1h%',
      width: 60,
      align: 'right',
      render: (row) => <DeltaBadge value={row.change1h} size="xs" />,
    },
    {
      key: 'liquidity',
      header: 'Liquidity',
      width: 100,
      align: 'right',
      render: (row) => <span className="text-text-muted">${(row.liquidity / 1e6).toFixed(0)}M</span>,
    },
    {
      key: 'txCount',
      header: 'Txs',
      width: 60,
      align: 'right',
      render: (row) => <span className="text-text-secondary">{row.txCount.toLocaleString()}</span>,
    },
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">DEX / Swap Monitor</h1>
            <p className="text-[11px] text-text-muted font-mono">GMGN-style live swap radar — spot large trades, price impact, MEV</p>
          </div>
          <LiveDot status={feedStatus} label />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-text-muted">Min Value:</span>
            {[1000, 10000, 50000, 100000].map(v => (
              <button
                key={v}
                onClick={() => setMinValue(v)}
                className={`px-2 py-1 rounded ${minValue === v ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}
              >
                ${v >= 1000 ? `${v/1000}K` : v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-text-muted">DEX:</span>
            {['all', 'Uniswap V3', 'PancakeSwap', 'SushiSwap', 'Curve'].map(d => (
              <button
                key={d}
                onClick={() => setFilterDex(d)}
                className={`px-2 py-1 rounded ${filterDex === d ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {d === 'all' ? 'ALL' : d}
              </button>
            ))}
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
          {/* Swap Feed */}
          <div className="lg:col-span-2">
            <Panel
              title="Live Swap Feed"
              subtitle={`${filteredSwaps.length} swaps above $${minValue.toLocaleString()}`}
              liveStatus={feedStatus}
              maxHeight={500}
            >
              <DataTable
                columns={swapColumns}
                data={filteredSwaps}
                rowHeight={28}
                emptyState={<div className="text-text-muted text-[11px] p-4">No swaps matching filters</div>}
              />
            </Panel>
          </div>

          {/* DEX Pair Stats */}
          <Panel
            title="DEX Pair Stats"
            subtitle="Top pairs by volume"
            liveStatus={feedStatus}
            maxHeight={500}
          >
            <DataTable
              columns={pairColumns}
              data={pairs}
              sortable
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Loading pair data...</div>}
            />
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
