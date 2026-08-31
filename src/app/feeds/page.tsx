'use client'

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { Flame, TrendingUp, ExternalLink, RefreshCw, Zap, Activity } from 'lucide-react'

interface FeedItem {
  id: string
  t: string   // title
  s: string   // summary
  u: string   // url
  ts: string  // timestamp
  h: string   // heat score
  c: string   // category
}

interface FeedGroup {
  id: string
  label: string
  count: number
  items: FeedItem[]
}

interface FeedResponse {
  feed: FeedGroup[]
  top: FeedItem[]
  sentiment: unknown
  flow: Record<string, number>
  prices: unknown[]
  alerts: unknown[]
  ttl: number
  generated: string
}

const CATEGORY_COLORS: Record<string, string> = {
  VIRAL: 'text-data-bull',
  MODELS: 'text-teal-vivid',
  RESEARCH: 'text-amber-400',
  INDUSTRY: 'text-blue-400',
  TRENDING: 'text-purple-400',
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  VIRAL: <Flame size={12} />,
  MODELS: <Zap size={12} />,
  RESEARCH: <Activity size={12} />,
  INDUSTRY: <TrendingUp size={12} />,
  TRENDING: <Zap size={12} />,
}

function feedItem(item: FeedItem, rank?: number) {
  const ts = item.ts ? new Date(Number(item.ts) * 1000).toLocaleString() : ''
  const color = CATEGORY_COLORS[item.c] ?? 'text-text-muted'
  return (
    <a
      key={item.id}
      href={item.u}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-3 py-2 border-b border-bg-border last:border-0 hover:bg-bg-raised transition-colors group"
    >
      <div className="flex items-start gap-3">
        {rank != null && (
          <span className="text-xs font-mono text-text-muted w-5 shrink-0 text-right pt-0.5">#{rank}</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${color}`}>
              {item.c}
            </span>
            {item.h && Number(item.h) > 50 && (
              <span className="text-[10px] font-mono text-data-bear flex items-center gap-0.5">
                <Flame size={8} /> {item.h}
              </span>
            )}
            <span className="text-[10px] text-text-muted ml-auto">{ts}</span>
          </div>
          <p className="text-sm font-medium text-text-primary truncate group-hover:text-teal-vivid transition-colors">
            {item.t}
          </p>
          <p className="text-xs text-text-muted line-clamp-1 mt-0.5">{item.s}</p>
        </div>
        <ExternalLink size={12} className="shrink-0 text-text-muted opacity-0 group-hover:opacity-100 mt-1" />
      </div>
    </a>
  )
}

export default function FeedsPage() {
  const [data, setData] = useState<FeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['viral', 'models']))

  const fetchFeeds = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/feed?limit=50')
      const json = await res.json()
      const d = json?.data ?? json
      if (d?.feed) {
        setData(d)
        setError(null)
      } else {
        setError('Feed data unavailable')
      }
    } catch {
      setError('Failed to load feeds')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchFeeds(); const id = setInterval(fetchFeeds, 60_000); return () => clearInterval(id) }, [fetchFeeds])

  const toggleGroup = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Feeds</h1>
            <p className="text-xs text-text-muted mt-1">
              {data?.generated ? `Updated ${new Date(data.generated).toLocaleTimeString()}` : 'Aggregated news, models, research'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot status={error ? 'error' : data ? 'live' : 'stale'} size={6} />
            <button onClick={fetchFeeds} className="p-1.5 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-center py-12 text-sm text-text-muted">Loading feeds…</div>
        )}

        {error && (
          <div className="text-center py-12 text-sm text-data-bear">{error}</div>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left column: Feed groups */}
            <div className="lg:col-span-2 space-y-4">
              {data.feed.map(group => (
                <Panel
                  key={group.id}
                  title={group.label.toUpperCase()}
                  subtitle={`${group.count} items`}
                  liveStatus="live"
                  actions={[
                    <button
                      key="toggle"
                      onClick={() => toggleGroup(group.id)}
                      className="text-xs text-teal-vivid hover:text-teal-vivid/80 transition-colors"
                    >
                      {expanded.has(group.id) ? 'Collapse' : `Show ${group.count}`}
                    </button>,
                  ]}
                >
                  <div className="divide-y divide-bg-border">
                    {expanded.has(group.id)
                      ? group.items.map(item => feedItem(item))
                      : group.items.slice(0, 3).map(item => feedItem(item))
                    }
                  </div>
                </Panel>
              ))}
            </div>

            {/* Right column: Top items + Flow */}
            <div className="space-y-4">
              <Panel title="🔥 TRENDING" subtitle="Top ranked" liveStatus="live">
                <div className="divide-y divide-bg-border">
                  {data.top.slice(0, 10).map((item, i) => feedItem(item, i + 1))}
                </div>
              </Panel>

              {data.flow && Object.keys(data.flow).length > 0 && (
                <Panel title="Market Flow" subtitle="Buy/sell activity" liveStatus="live">
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Buy Volume</span>
                      <span className="font-mono text-data-bull">${(data.flow.totalBuyVolume / 1e6).toFixed(1)}M</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Sell Volume</span>
                      <span className="font-mono text-data-bear">${(data.flow.totalSellVolume / 1e6).toFixed(1)}M</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Net Flow</span>
                      <span className={`font-mono ${(data.flow.totalNetFlow ?? 0) >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                        ${((data.flow.totalNetFlow ?? 0) / 1e6).toFixed(1)}M
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Buy/Sell Ratio</span>
                      <span className="font-mono text-text-primary">{data.flow.overallBuySellRatio?.toFixed(2) ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Large Trades</span>
                      <span className="font-mono text-text-primary">{data.flow.largeTradeCount ?? 0}</span>
                    </div>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}