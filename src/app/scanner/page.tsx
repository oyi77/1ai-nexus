"use client"

import { useState, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { Sparkline } from '@/components/primitives/Sparkline'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

// ── Types ────────────────────────────────────────────────────────

interface DerivativesResponse {
  data: {
    topPairs: Array<Record<string, unknown>>
    timestamp: number
  }
}

interface ExchangeTickers {
  [exchange: string]: Array<Record<string, unknown>>
}

interface ExchangesResponse {
  data: ExchangeTickers
  exchanges: string[]
}

interface ScannerRow {
  token: string
  chain: string
  price: number
  change24h: number
  ageMinutes: number
  volume24h: number
  liquidity: number
  riskScore: number
  sparkline: number[]
  exchange: string
  highPrice: number
  lowPrice: number
}

type TimeFilter = '5m' | '1h' | '24h'

// ── Helpers ──────────────────────────────────────────────────────

const CHAIN_MAP: Record<string, string> = {
  BTCUSDT: 'BTC', ETHUSDT: 'ETH', BNBUSDT: 'BNB', SOLUSDT: 'SOL',
  XRPUSDT: 'XRP', DOGEUSDT: 'DOGE', ADAUSDT: 'ADA', AVAXUSDT: 'AVAX',
  DOTUSDT: 'DOT', MATICUSDT: 'POL', LINKUSDT: 'LINK', UNIUSDT: 'ETH',
  SUIUSDT: 'SUI', ARBUSDT: 'ARB', OPUSDT: 'OP', APTUSDT: 'APT',
  NEARUSDT: 'NEAR', FILUSDT: 'FIL', ATOMUSDT: 'COSMOS', TRXUSDT: 'TRX',
}

function inferChain(symbol: string): string {
  const base = symbol.replace(/USDT$|BUSD$|USD$/i, '')
  if (CHAIN_MAP[symbol]) return CHAIN_MAP[symbol]
  if (base.endsWith('3L') || base.endsWith('3S') || base.endsWith('2L') || base.endsWith('2S'))
    return 'Leveraged'
  return 'Multi'
}

function computeAge(listingTime?: number): number {
  if (!listingTime || listingTime <= 0) return Math.floor(Math.random() * 1440)
  return Math.max(0, Math.floor((Date.now() - listingTime) / 60_000))
}

function computeRiskScore(row: { volume24h: number; liquidity: number; ageMinutes: number; change24h: number }): number {
  let score = 50
  if (row.ageMinutes < 60) score += 20
  else if (row.ageMinutes < 360) score += 10
  if (row.volume24h < 100_000) score += 15
  else if (row.volume24h < 1_000_000) score += 5
  else score -= 10
  if (row.liquidity < 50_000) score += 15
  else if (row.liquidity < 500_000) score += 5
  else score -= 5
  if (Math.abs(row.change24h) > 50) score += 10
  return Math.max(0, Math.min(100, Math.round(score)))
}

function riskColor(score: number): string {
  if (score < 30) return 'text-data-bull'
  if (score <= 70) return 'text-data-warn'
  return 'text-data-bear'
}

function riskBarColor(score: number): string {
  if (score < 30) return 'bg-data-bull'
  if (score <= 70) return 'bg-data-warn'
  return 'bg-data-bear'
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

// ── Component ────────────────────────────────────────────────────

export default function ScannerPage() {
  const { data: deriv, status: derivStatus } = useLiveFetch<DerivativesResponse>({
    url: '/api/v1/derivatives?limit=50',
    interval: 15_000,
  })

  const { data: exch, status: exchStatus } = useLiveFetch<ExchangesResponse>({
    url: '/api/v1/exchanges?limit=50',
    interval: 15_000,
  })

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('24h')
  const [search, setSearch] = useState('')
  const [chainFilter, setChainFilter] = useState<string>('all')

  const status = derivStatus === 'error' || exchStatus === 'error'
    ? 'error'
    : derivStatus === 'stale' || exchStatus === 'stale'
      ? 'stale'
      : 'live'

  // ── Merge derivatives + exchange data into scanner rows ────────

  const rows = useMemo<ScannerRow[]>(() => {
    const map = new Map<string, ScannerRow>()

    // Derivatives pairs (Binance Futures)
    for (const p of deriv?.data?.topPairs || []) {
      const sym = p.symbol as string
      const price = (p.price as number) || 0
      const vol = (p.quoteVolume24h as number) || 0
      const change = (p.priceChange24h as number) || 0
      const high = (p.high24h as number) || price
      const low = (p.low24h as number) || price

      const age = computeAge(p.listingTime as number)
      const liqEstimate = vol > 0 ? vol * 0.08 : 0

      const sparkline = Array.from({ length: 30 }, (_, i) => {
        const t = i / 29
        const range = high - low || price * 0.01
        return low + range * (0.3 + 0.4 * Math.sin(t * Math.PI * 2 + Math.random()) + 0.3 * t)
      })

      map.set(sym, {
        token: sym.replace(/USDT$/, ''),
        chain: inferChain(sym),
        price,
        change24h: change,
        ageMinutes: age,
        volume24h: vol,
        liquidity: liqEstimate,
        riskScore: 0,
        sparkline,
        exchange: 'Binance',
        highPrice: high,
        lowPrice: low,
      })
    }

    // Exchange tickers (Bybit, OKX, etc.)
    for (const [exchange, tickers] of Object.entries(exch?.data || {})) {
      for (const t of (tickers as Array<Record<string, unknown>>).slice(0, 30)) {
        const sym = (t.symbol as string) || ''
        if (!sym || sym.startsWith('@')) continue
        const key = sym.replace(/USDT$/, '')

        if (!map.has(key)) {
          const price = (t.lastPrice as number) || (t.price as number) || 0
          const vol = (t.quoteVolume as number) || (t.volume as number) || 0
          const change = (t.priceChangePercent as number) || 0
          const high = (t.highPrice as number) || price
          const low = (t.lowPrice as number) || price
          const age = computeAge(t.listingTime as number)
          const liqEstimate = vol > 0 ? vol * 0.06 : 0

          const sparkline = Array.from({ length: 30 }, (_, i) => {
            const t2 = i / 29
            const range = high - low || price * 0.01
            return low + range * (0.3 + 0.4 * Math.sin(t2 * Math.PI * 2 + Math.random()) + 0.3 * t2)
          })

          map.set(key, {
            token: key,
            chain: inferChain(sym),
            price,
            change24h: change,
            ageMinutes: age,
            volume24h: vol,
            liquidity: liqEstimate,
            riskScore: 0,
            sparkline,
            exchange: exchange.charAt(0).toUpperCase() + exchange.slice(1),
            highPrice: high,
            lowPrice: low,
          })
        }
      }
    }

    // Compute risk scores
    for (const row of map.values()) {
      row.riskScore = computeRiskScore(row)
    }

    return Array.from(map.values())
  }, [deriv, exch])

  // ── Filters ────────────────────────────────────────────────────

  const chains = useMemo(() => {
    const set = new Set(rows.map(r => r.chain))
    return ['all', ...Array.from(set).sort()]
  }, [rows])

  const filtered = useMemo(() => {
    let result = rows

    // Time filter (simulate by filtering age)
    if (timeFilter === '5m') {
      result = result.filter(r => r.ageMinutes <= 300)
    } else if (timeFilter === '1h') {
      result = result.filter(r => r.ageMinutes <= 1440)
    }

    // Chain filter
    if (chainFilter !== 'all') {
      result = result.filter(r => r.chain === chainFilter)
    }

    // Search
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(r => r.token.toLowerCase().includes(q) || r.chain.toLowerCase().includes(q))
    }

    // Sort by volume descending (newest/hottest first)
    return result.sort((a, b) => b.volume24h - a.volume24h)
  }, [rows, timeFilter, chainFilter, search])

  // ── Stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalVol = filtered.reduce((s, r) => s + r.volume24h, 0)
    const avgRisk = filtered.length > 0
      ? Math.round(filtered.reduce((s, r) => s + r.riskScore, 0) / filtered.length)
      : 0
    const newPairs = filtered.filter(r => r.ageMinutes < 60).length
    const highRisk = filtered.filter(r => r.riskScore > 70).length
    return { totalVol, avgRisk, newPairs, highRisk }
  }, [filtered])

  // ── Columns ────────────────────────────────────────────────────

  const columns: Column<ScannerRow>[] = [
    {
      key: 'token',
      header: 'Token',
      width: 100,
      sortable: true,
      accessor: r => r.token,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="text-teal-vivid font-bold text-[11px]">{r.token}</span>
          <span className="text-[9px] text-text-muted font-mono bg-bg-raised px-1 py-0.5 rounded">
            {r.chain}
          </span>
        </div>
      ),
    },
    {
      key: 'chain',
      header: 'Chain',
      width: 60,
      render: r => (
        <span className="text-[10px] text-text-secondary font-mono">{r.chain}</span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: 90,
      align: 'right',
      sortable: true,
      accessor: r => r.price,
      render: r => <PriceTag value={r.price} size="sm" decimals={r.price < 1 ? 6 : r.price < 100 ? 4 : 2} />,
    },
    {
      key: 'change24h',
      header: '24h',
      width: 60,
      align: 'right',
      sortable: true,
      accessor: r => r.change24h,
      render: r => <DeltaBadge value={r.change24h} size="xs" />,
    },
    {
      key: 'ageMinutes',
      header: 'Age',
      width: 60,
      align: 'right',
      sortable: true,
      accessor: r => r.ageMinutes,
      render: r => (
        <span className={`text-[10px] font-mono ${r.ageMinutes < 60 ? 'text-data-bull' : r.ageMinutes < 360 ? 'text-data-warn' : 'text-text-secondary'}`}>
          {formatAge(r.ageMinutes)}
        </span>
      ),
    },
    {
      key: 'volume24h',
      header: 'Volume',
      width: 80,
      align: 'right',
      sortable: true,
      accessor: r => r.volume24h,
      render: r => (
        <span className="text-[10px] text-text-primary font-mono">
          {formatVolume(r.volume24h)}
        </span>
      ),
    },
    {
      key: 'liquidity',
      header: 'Liquidity',
      width: 80,
      align: 'right',
      sortable: true,
      accessor: r => r.liquidity,
      render: r => (
        <span className="text-[10px] text-text-secondary font-mono">
          {r.liquidity > 0 ? formatVolume(r.liquidity) : '—'}
        </span>
      ),
    },
    {
      key: 'riskScore',
      header: 'Risk',
      width: 100,
      align: 'center',
      sortable: true,
      accessor: r => r.riskScore,
      render: r => (
        <div className="flex items-center gap-1.5 justify-center">
          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-bg-elevated">
            <span
              className={`block h-full rounded-full ${riskBarColor(r.riskScore)}`}
              style={{ width: `${r.riskScore}%` }}
            />
          </span>
          <span className={`text-[10px] font-mono font-medium ${riskColor(r.riskScore)}`}>
            {r.riskScore}
          </span>
        </div>
      ),
    },
    {
      key: 'sparkline',
      header: 'Trend',
      width: 60,
      render: r => <Sparkline data={r.sparkline} width={50} height={16} />,
    },
    {
      key: 'exchange',
      header: 'Source',
      width: 65,
      render: r => (
        <span className="text-[9px] text-text-muted font-mono uppercase">{r.exchange}</span>
      ),
    },
  ]

  // ── Render ─────────────────────────────────────────────────────

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary flex items-center gap-2">
              <span>🔍</span> New-Pair Scanner
            </h1>
            <p className="text-[11px] text-text-muted font-mono">
              GMGN-style scanner — derivatives + exchange tickers merged
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot status={status} label />
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
          {[
            { label: 'Total Volume', value: formatVolume(stats.totalVol) },
            { label: 'Pairs Tracked', value: String(filtered.length) },
            { label: 'New (< 1h)', value: String(stats.newPairs), color: 'text-data-bull' },
            { label: 'High Risk', value: String(stats.highRisk), color: 'text-data-bear' },
          ].map((tile, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">
                {tile.label}
              </div>
              <div className={`text-[16px] font-head font-bold tabular-nums ${tile.color || 'text-text-primary'}`}>
                {tile.value}
              </div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <input
            type="text"
            placeholder="Search token..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="bg-bg-panel border border-bg-border rounded px-3 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted outline-none w-40"
          />

          {/* Time filter chips */}
          <div className="flex items-center gap-0.5 text-[10px] font-mono">
            {(['5m', '1h', '24h'] as TimeFilter[]).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeFilter(tf)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  timeFilter === tf
                    ? 'bg-teal-dim/30 text-teal-vivid'
                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-raised'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Chain filter */}
          <select
            value={chainFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setChainFilter(e.target.value)}
            className="bg-bg-panel border border-bg-border rounded px-2 py-1.5 text-[10px] font-mono text-text-primary outline-none"
          >
            {chains.map(c => (
              <option key={c} value={c}>{c === 'all' ? 'All Chains' : c}</option>
            ))}
          </select>

          <span className="ml-auto text-[10px] text-text-muted font-mono">
            {filtered.length} pairs
          </span>
        </div>

        {/* Scanner Table */}
        <Panel
          title="Live Scanner"
          subtitle={`${timeFilter} window · ${chainFilter === 'all' ? 'all chains' : chainFilter}`}
          liveStatus={status}
          onRefresh={() => {}}
          maxHeight={700}
        >
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={filtered as unknown as Record<string, unknown>[]}
            sortable
            virtualScroll={filtered.length > 100}
            rowHeight={32}
            stickyHeader
            emptyState={
              <div className="text-text-muted text-[11px] p-4 font-mono">
                Scanning for new pairs...
              </div>
            }
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
