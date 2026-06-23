"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { EntityLabel } from '@/components/primitives/EntityLabel'

interface KPIData {
  label: string
  value: string
  delta?: number
  prefix?: string
  suffix?: string
}

interface NewsItem {
  id: string
  title: string
  url: string
  sourceId: string
  publishedAt: string
  category: string
  [key: string]: unknown
}

interface DexTrending {
  name: string
  priceUsd: number
  fdv: number
  volume24h: number
  priceChange24h: number
  [key: string]: unknown
}

interface WhaleMove {
  txid: string
  valueBtc: number
  valueUsd: number
  block: number
  [key: string]: unknown
}

interface ActivityEvent {
  id: string
  type: string
  headline: string
  asset: string
  direction: string
  strength: number
  timestamp: string
  [key: string]: unknown
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${(n ?? 0).toFixed(0)}`
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<KPIData[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [dex, setDex] = useState<DexTrending[]>([])
  const [whaleMoves, setWhaleMoves] = useState<WhaleMove[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')

  const fetchData = useCallback(async () => {
    try {
      const [derivRes, fgRes, whaleRes, alphaRes, newsRes, dexRes] = await Promise.allSettled([
        fetch('/api/v1/derivatives?limit=10').then(r => r.json()),
        fetch('/api/v1/fear-greed').then(r => r.json()),
        fetch('/api/v1/mempool?action=whale').then(r => r.json()),
        fetch('/api/v1/alpha-feed?limit=10').then(r => r.json()),
        fetch('/api/v1/news?category=crypto&limit=10').then(r => r.json()),
        fetch('/api/v1/dex/trending?network=solana').then(r => r.json()),
      ])

      const deriv = derivRes.status === 'fulfilled' ? derivRes.value?.data : null
      const fg = fgRes.status === 'fulfilled' ? fgRes.value?.data : null
      const btcPrice = deriv?.topPairs?.[0]?.price ?? 0
      const fgScore = fg?.composite?.score ?? 0

      setKpis([
        { label: 'BTC Price', value: `$${(btcPrice ?? 0).toLocaleString()}`, delta: deriv?.topPairs?.[0]?.priceChange24h ?? 0 },
        { label: 'Fear & Greed', value: String(fgScore), suffix: '/100' },
        { label: 'Global Crypto', value: '$2.5T' }, // Can be replaced with actual global market cap
        { label: 'Whale TXs', value: String(whaleRes.status === 'fulfilled' ? (whaleRes.value?.data?.transactions?.length ?? 0) : 0) },
      ])

      if (newsRes.status === 'fulfilled' && Array.isArray(newsRes.value?.data?.items)) {
        setNews(newsRes.value.data.items.slice(0, 10).map((n: Record<string, unknown>) => ({
          id: String(n.id ?? ''),
          title: String(n.title ?? ''),
          url: String(n.url ?? ''),
          sourceId: String(n.sourceId ?? ''),
          publishedAt: String(n.publishedAt ?? ''),
          category: String(n.category ?? ''),
        })))
      }

      if (dexRes.status === 'fulfilled' && Array.isArray(dexRes.value?.data?.items)) {
        setDex(dexRes.value.data.items.slice(0, 10).map((d: Record<string, unknown>) => ({
          name: String(d.name ?? ''),
          priceUsd: Number(d.priceUsd ?? 0),
          fdv: Number(d.fdv ?? 0),
          volume24h: Number(d.volume24h ?? 0),
          priceChange24h: Number(d.priceChange24h ?? 0),
        })))
      }

      const whaleData = whaleRes.status === 'fulfilled' ? whaleRes.value?.data : null
      if (whaleData?.transactions) {
        setWhaleMoves(whaleData.transactions.slice(0, 10).map((w: Record<string, unknown>) => ({
          txid: String(w.txid ?? ''),
          valueBtc: Number(w.valueBtc ?? 0),
          valueUsd: Number(w.valueUsd ?? 0),
          block: Number(w.block ?? 0),
        })))
      }

      const alphaData = alphaRes.status === 'fulfilled' ? alphaRes.value?.data : null
      if (Array.isArray(alphaData)) {
        setActivity(alphaData.slice(0, 10).map((s: Record<string, unknown>) => ({
          id: String(s.id ?? ''),
          type: String(s.type ?? 'signal'),
          headline: String(s.headline ?? ''),
          asset: String(s.asset ?? ''),
          direction: String(s.direction ?? 'neutral'),
          strength: (s.strength as number) ?? 0,
          timestamp: s.timestamp ? new Date(s.timestamp as string).toLocaleTimeString() : '',
        })))
      }

      setFeedStatus('live')
    } catch {
      setFeedStatus('error')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const newsColumns: Column<NewsItem>[] = [
    { key: 'title', header: 'Headline (Bloomberg / Macro)', width: 300, render: r => (
      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-text-primary hover:text-teal-vivid truncate block">
        {r.title}
      </a>
    )},
    { key: 'category', header: 'Cat', width: 80, render: r => <span className="text-[10px] text-text-muted font-mono">{r.category}</span> },
    { key: 'sourceId', header: 'Source', width: 100, align: 'right', render: r => <span className="text-[10px] text-text-muted font-mono uppercase">{r.sourceId}</span> },
  ]

  const dexColumns: Column<DexTrending>[] = [
    { key: 'name', header: 'Trending Pair (GMGN)', width: 150, render: r => <span className="text-teal-vivid font-bold text-[11px] truncate">{r.name}</span> },
    { key: 'priceUsd', header: 'Price', width: 80, align: 'right', render: r => <PriceTag value={r.priceUsd} size="sm" /> },
    { key: 'priceChange24h', header: '24h', width: 60, align: 'right', render: r => <DeltaBadge value={r.priceChange24h} size="xs" /> },
    { key: 'volume24h', header: 'Vol(24h)', width: 80, align: 'right', render: r => <span className="text-text-secondary font-mono text-[10px]">{fmtUsd(r.volume24h)}</span> },
  ]

  const whaleColumns: Column<WhaleMove>[] = [
    { key: 'txid', header: 'Onchain Flow (Arkham)', width: 140, render: r => <span className="text-text-muted font-mono text-[10px]">{String(r.txid).slice(0, 16)}...</span> },
    { key: 'valueBtc', header: 'BTC', width: 80, align: 'right', render: r => <span className="text-teal-vivid font-bold tabular-nums">{(r.valueBtc ?? 0).toFixed(2)} ₿</span> },
    { key: 'valueUsd', header: 'USD', width: 80, align: 'right', render: r => <PriceTag value={r.valueUsd} size="sm" /> },
  ]

  const activityColumns: Column<ActivityEvent>[] = [
    { key: 'headline', header: 'Entity / Smart Money Signal (Nansen)', width: 250, render: r => <span className="text-text-primary text-[11px] truncate block">{r.headline}</span> },
    { key: 'asset', header: 'Asset', width: 60, render: r => <span className="text-teal-vivid font-mono text-[10px]">{r.asset}</span> },
    { key: 'direction', header: 'Dir', width: 50, render: r => (
      <span className={`text-[10px] font-mono font-bold ${r.direction === 'bullish' ? 'text-data-bull' : r.direction === 'bearish' ? 'text-data-bear' : 'text-text-muted'}`}>
        {r.direction === 'bullish' ? '🟢' : r.direction === 'bearish' ? '🔴' : '⚪'}
      </span>
    )},
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Command Center</h1>
            <p className="text-[11px] text-text-muted font-mono">Global Market View — News, Trending DEX, On-chain Flows</p>
          </div>
          <LiveDot status={feedStatus} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-1">
          {kpis.map((kpi, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{kpi.label}</div>
              <div className="text-[18px] font-head font-bold tabular-nums text-text-primary">
                {kpi.prefix}{kpi.value}{kpi.suffix}
              </div>
              {kpi.delta !== undefined && kpi.delta !== 0 && (
                <div className={`text-[10px] font-mono ${kpi.delta > 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                  {kpi.delta > 0 ? '+' : ''}{(kpi.delta ?? 0).toFixed(2)}%
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Top Split: News (Bloomberg) vs Trending DEX (GMGN) */}
        <div className="grid grid-cols-2 gap-3">
          <Panel title="Global News Feed" subtitle="Macro & Crypto (Bloomberg-style)" liveStatus={feedStatus} onRefresh={fetchData}>
            <DataTable
              columns={newsColumns as unknown as Column<Record<string, unknown>>[]}
              data={news as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Aggregating global news...</div>}
            />
          </Panel>

          <Panel title="DEX Trending" subtitle="Hot pairs on Solana (GMGN-style)" liveStatus={feedStatus} onRefresh={fetchData}>
            <DataTable
              columns={dexColumns as unknown as Column<Record<string, unknown>>[]}
              data={dex as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Scanning liquidity pools...</div>}
            />
          </Panel>
        </div>

        {/* Bottom Split: Entity/Smart Money (Nansen) vs Whale Flows (Arkham) */}
        <div className="grid grid-cols-2 gap-3">
          <Panel title="Smart Money Signals" subtitle="Entity insights (Nansen-style)" liveStatus={feedStatus} onRefresh={fetchData}>
            <DataTable
              columns={activityColumns as unknown as Column<Record<string, unknown>>[]}
              data={activity as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Waiting for smart money signals...</div>}
            />
          </Panel>

          <Panel title="Whale Moves" subtitle="Large on-chain flows (Arkham-style)" liveStatus={feedStatus} onRefresh={fetchData}>
            <DataTable
              columns={whaleColumns as unknown as Column<Record<string, unknown>>[]}
              data={whaleMoves as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-[11px] p-4">Monitoring mempool for whale TXs...</div>}
            />
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
