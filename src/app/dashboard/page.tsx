"use client"
import { LiveTerminalFeed } from '@/components/features/LiveTerminalFeed'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'

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
  id: string
  amount: number
  symbol: string
  usd: number
  from: string
  to: string
  link?: string
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

interface AlphaSignalCard {
  id: string
  type: string
  asset: string
  strength: number
  confidence: number
  headline: string
  explanation: string
  source: string
  timestamp: string
}

interface ThesisCard {
  symbol: string
  thesis: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  confidence: number
  totalSignals: number
}

interface TrendingCard {
  id: string
  title: string
  source: string
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
        fetch('/api/v1/whale-alert').then(r => r.json()),
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
        { label: 'Whale Alerts', value: String(whaleRes.status === 'fulfilled' ? (whaleRes.value?.data?.items?.length ?? 0) : 0) },
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
      if (whaleData?.items) {
        setWhaleMoves(whaleData.items.slice(0, 10).map((w: Record<string, unknown>) => ({
          id: String(w.id ?? ''),
          amount: Number(w.amount ?? 0),
          symbol: String(w.symbol ?? ''),
          usd: Number(w.usd ?? 0),
          from: String(w.from ?? ''),
          to: String(w.to ?? ''),
          link: w.link ? String(w.link) : undefined,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
fetchData()
    const interval = setInterval(fetchData, 15_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const [alphaSignals, setAlphaSignals] = useState<AlphaSignalCard[]>([])
  const [thesis, setThesis] = useState<ThesisCard | null>(null)
  const [trending, setTrending] = useState<TrendingCard[]>([])
  const [intelStatus, setIntelStatus] = useState<'live' | 'stale' | 'error'>('live')

  const fetchIntel = useCallback(async () => {
    const [alphaRes, thesisRes, feedRes] = await Promise.allSettled([
      fetch('/api/v1/alpha-feed?limit=5').then(r => r.json()),
      fetch('/api/v1/token/thesis?symbol=BTC').then(r => r.json()),
      fetch('/api/v1/feed?limit=3').then(r => r.json()),
    ])

    if (alphaRes.status === 'fulfilled' && Array.isArray(alphaRes.value?.data)) {
      setAlphaSignals((alphaRes.value.data as Record<string, unknown>[]).slice(0, 5).map(s => ({
        id: String(s.id ?? ''),
        type: String(s.type ?? 'signal'),
        asset: String(s.asset ?? ''),
        strength: Number(s.strength ?? 0),
        confidence: Number(s.confidence ?? 0),
        headline: String(s.headline ?? ''),
        explanation: String(s.explanation ?? ''),
        source: String(s.source ?? ''),
        timestamp: s.timestamp ? new Date(String(s.timestamp)).toLocaleTimeString() : '',
      })))
    }

    if (thesisRes.status === 'fulfilled' && thesisRes.value?.thesis) {
      const t = thesisRes.value as Record<string, unknown>
      const dir = t.thesis === 'BULLISH' || t.thesis === 'BEARISH' ? t.thesis : 'NEUTRAL'
      setThesis({
        symbol: String(t.symbol ?? 'BTC'),
        thesis: dir as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        confidence: Number(t.confidence ?? 0),
        totalSignals: Number(t.totalSignals ?? 0),
      })
    }

    if (feedRes.status === 'fulfilled' && Array.isArray(feedRes.value?.top)) {
      setTrending((feedRes.value.top as Record<string, unknown>[]).slice(0, 3).map(i => ({
        id: String(i.id ?? ''),
        title: String(i.t ?? ''),
        source: String(i.s ?? ''),
      })))
    }

    setIntelStatus('live')
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
fetchIntel()
  }, [fetchIntel])

  const newsColumns: Column<NewsItem>[] = [
    { key: 'title', header: 'Headline (Bloomberg / Macro)', width: 300, render: r => (
      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-text-primary hover:text-teal-vivid truncate block">
        {r.title}
      </a>
    )},
    { key: 'category', header: 'Cat', width: 80, render: r => <span className="text-xs text-text-muted font-mono">{r.category}</span> },
    { key: 'sourceId', header: 'Source', width: 100, align: 'right', render: r => <span className="text-xs text-text-muted font-mono uppercase">{r.sourceId}</span> },
  ]

  const dexColumns: Column<DexTrending>[] = [
    { key: 'name', header: 'Trending Pair (GMGN)', width: 150, render: r => <span className="text-teal-vivid font-bold text-xs truncate">{r.name}</span> },
    { key: 'priceUsd', header: 'Price', width: 80, align: 'right', render: r => <PriceTag value={r.priceUsd} size="sm" /> },
    { key: 'priceChange24h', header: '24h', width: 60, align: 'right', render: r => <DeltaBadge value={r.priceChange24h} size="xs" /> },
    { key: 'volume24h', header: 'Vol(24h)', width: 80, align: 'right', render: r => <span className="text-text-secondary font-mono text-xs">{fmtUsd(r.volume24h)}</span> },
  ]

  const whaleColumns: Column<WhaleMove>[] = [
    { key: 'from', header: 'Multi-Chain Flow (Whale Alert)', width: 250, render: r => (
      <div className="flex items-center space-x-1 truncate">
        <span className="text-text-primary text-xs truncate max-w-[100px]">{r.from}</span>
        <span className="text-text-muted text-xs">→</span>
        <span className="text-text-primary text-xs truncate max-w-[100px]">{r.to}</span>
        {r.link && (
          <a href={r.link} target="_blank" rel="noopener noreferrer" className="ml-1 text-teal-vivid hover:underline">
            ↗
          </a>
        )}
      </div>
    )},
    { key: 'amount', header: 'Amount', width: 100, align: 'right', render: r => (
      <span className="text-teal-vivid font-bold tabular-nums text-xs">
        {r.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs text-text-muted">{r.symbol}</span>
      </span>
    )},
    { key: 'usd', header: 'USD', width: 80, align: 'right', render: r => <PriceTag value={r.usd} size="sm" /> },
  ]

  const activityColumns: Column<ActivityEvent>[] = [
    { key: 'headline', header: 'Entity / Smart Money Signal (Nansen)', width: 250, render: r => <span className="text-text-primary text-xs truncate block">{r.headline}</span> },
    { key: 'asset', header: 'Asset', width: 60, render: r => <span className="text-teal-vivid font-mono text-xs">{r.asset}</span> },
    { key: 'direction', header: 'Dir', width: 50, render: r => (
      <span className={`text-xs font-mono font-bold ${r.direction === 'bullish' ? 'text-data-bull' : r.direction === 'bearish' ? 'text-data-bear' : 'text-text-muted'}`}>
        {r.direction === 'bullish' ? '🟢' : r.direction === 'bearish' ? '🔴' : '⚪'}
      </span>
    )},
  ]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Today&apos;s Intelligence — derived signals as the product */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Link href="/intelligence"><h2 className="text-[13px] font-head font-bold text-text-primary uppercase tracking-wide hover:text-teal-vivid transition-colors">Today&apos;s Intelligence →</h2></Link>
            <LiveDot status={intelStatus} label />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Panel title="Alpha Signals" subtitle="Top derived signals right now" liveStatus={intelStatus}>
              <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
                {alphaSignals.length === 0 ? (
                  <div className="text-text-muted text-xs p-4">No alpha signals available right now — signals appear as new data is derived.</div>
                ) : alphaSignals.map(s => (
                  <div key={s.id} className="border border-bg-border bg-bg-panel p-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-text-primary leading-snug">{s.headline}</span>
                      <span className="text-[10px] font-mono text-text-muted shrink-0 whitespace-nowrap">{s.timestamp}</span>
                    </div>
                    <p className="text-[11px] text-text-secondary leading-snug line-clamp-2">{s.explanation}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono uppercase text-teal-vivid truncate">{s.source}</span>
                      <span className="text-[10px] font-mono text-text-muted shrink-0">{(s.confidence * 100).toFixed(0)}% conf</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="BTC Trade Thesis" subtitle="Aggregated from all alpha sources" liveStatus={intelStatus}>
              {thesis ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-bold px-2 py-1 border ${thesis.thesis === 'BULLISH' ? 'text-data-bull bg-data-bull/20 border-data-bull/30' : thesis.thesis === 'BEARISH' ? 'text-data-bear bg-data-bear/20 border-data-bear/30' : 'text-text-secondary bg-bg-raised border-bg-border'}`}>
                      {thesis.thesis}
                    </span>
                    <span className="text-xs text-text-muted font-mono">{thesis.totalSignals} signal{thesis.totalSignals === 1 ? '' : 's'}</span>
                  </div>
                  <div className="text-[11px] text-text-secondary leading-snug">
                    {thesis.thesis === 'BULLISH'
                      ? 'Weighted alpha signals lean bullish — positive conviction across derived sources.'
                      : thesis.thesis === 'BEARISH'
                        ? 'Weighted alpha signals lean bearish — caution flagged across derived sources.'
                        : 'Signals are balanced — no dominant directional edge right now.'}
                  </div>
                  <div className="text-[11px] font-mono text-text-muted">
                    Confidence {(thesis.confidence * 100).toFixed(0)}% · BTC
                  </div>
                </div>
              ) : (
                <div className="text-text-muted text-xs p-4">No trade thesis available for BTC right now.</div>
              )}
            </Panel>

            <Panel title="Trending Now" subtitle="Hottest items across all feeds" liveStatus={intelStatus}>
              <div className="space-y-2">
                {trending.length === 0 ? (
                  <div className="text-text-muted text-xs p-4">No trending items right now — refreshing automatically.</div>
                ) : trending.map((t, i) => (
                  <div key={t.id || i} className="flex items-start gap-2 border border-bg-border bg-bg-panel p-2">
                    <span className="text-xs font-mono font-bold text-teal-vivid shrink-0">#{i + 1}</span>
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs text-text-primary leading-snug line-clamp-2">{t.title}</div>
                      {t.source && <div className="text-[10px] font-mono uppercase text-text-muted truncate">{t.source}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Command Center</h1>
            <p className="text-xs text-text-muted">Global Market View — News, Trending DEX, On-chain Flows</p>
          </div>
          <LiveDot status={feedStatus} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-1">
          {kpis.map((kpi, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-xs text-text-muted font-mono uppercase mb-1">{kpi.label}</div>
              <div className="text-[18px] font-head font-bold tabular-nums text-text-primary">
                {kpi.prefix}{kpi.value}{kpi.suffix}
              </div>
              {kpi.delta !== undefined && kpi.delta !== 0 && (
                <div className={`text-xs font-mono ${kpi.delta > 0 ? 'text-data-bull' : 'text-data-bear'}`}>
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
              emptyState={<div className="text-text-muted text-xs p-4">No live news yet — we refresh every 15s. Connect a news source in Settings to start tracking.</div>}
            />
          </Panel>

          <Panel title="DEX Trending" subtitle="Hot pairs on Solana (GMGN-style)" liveStatus={feedStatus} onRefresh={fetchData}>
            <DataTable
              columns={dexColumns as unknown as Column<Record<string, unknown>>[]}
              data={dex as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">No trending pairs yet — refreshing every 15s. Add a DEX feed to populate this panel.</div>}
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
              emptyState={<div className="text-text-muted text-xs p-4">No smart-money signals yet — waiting for the next scan. Data appears automatically.</div>}
            />
          </Panel>

          <Panel title="Whale Moves" subtitle="Large on-chain flows (Arkham-style)" liveStatus={feedStatus} onRefresh={fetchData}>
            <DataTable
              columns={whaleColumns as unknown as Column<Record<string, unknown>>[]}
              data={whaleMoves as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">No whale moves yet — monitoring the mempool. Large flows show up here as they happen.</div>}
            />
          </Panel>
        </div>

        {/* Live Terminal Feed */}
        <Panel title="LIVE TERMINAL FEED" subtitle="Aggregated real-time intelligence from all sources" liveStatus={feedStatus}>
          <div className="h-[300px]">
            <LiveTerminalFeed />
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
