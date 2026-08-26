"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface NewsEvent {
  source: string
  headline: string
  url: string
  entities: string[]
  relevanceScore: number
  severityScore: number
  direction: string
  publishedAt: string
  category: string
}

interface SentimentData {
  source: string
  score: number
  label: string
  metadata: Record<string, unknown>
  timestamp: string
}

interface ExchangeStatus {
  exchange: string
  status: string
  message: string
  updatedAt: string
}

export default function NewsIntelPage() {
  const [events, setEvents] = useState<NewsEvent[]>([])
  const [exchangeStatuses, setExchangeStatuses] = useState<ExchangeStatus[]>([])
  const [sentiment, setSentiment] = useState<SentimentData[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterDirection, setFilterDirection] = useState<string>('all')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [newsRes, sentimentRes] = await Promise.allSettled([
          fetch('/api/v1/news-intel?action=news'),
          fetch('/api/v1/news-intel?action=sentiment'),
        ])

        if (newsRes.status === 'fulfilled') {
          const d = await newsRes.value.json()
          if (d.data?.news) {
            setEvents(d.data.news.events ?? [])
            setExchangeStatuses(d.data.news.exchangeStatuses ?? [])
          }
        }

        if (sentimentRes.status === 'fulfilled') {
          const d = await sentimentRes.value.json()
          if (d.data?.sentiment) setSentiment(d.data.sentiment)
        }

        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 300_000) // 5 min
    return () => clearInterval(interval)
  }, [])

  const categories = useMemo(() => ['all', ...new Set(events.map(e => e.category))], [events])
  const filtered = useMemo(() => {
    let data = events
    if (filterCategory !== 'all') data = data.filter(e => e.category === filterCategory)
    if (filterDirection !== 'all') data = data.filter(e => e.direction === filterDirection)
    return data
  }, [events, filterCategory, filterDirection])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">NEWS INTELLIGENCE</h1>
            <p className="text-xs text-text-muted mt-1">
              GDELT global news + SEC EDGAR filings + exchange status + sentiment aggregation
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Sentiment Strip */}
        {sentiment.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {sentiment.map(s => (
              <div key={s.source} className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-xs text-text-muted uppercase">{s.source.replace(/-/g, ' ')}</p>
                <p className={`text-lg font-mono font-bold ${
                  s.score >= 60 ? 'text-data-bull' : s.score <= 40 ? 'text-data-bear' : 'text-text-primary'
                }`}>{s.score}</p>
                <p className="text-xs text-text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Exchange Status */}
        {exchangeStatuses.length > 0 && (
          <Panel title="Exchange Status" subtitle="Live system status">
            <div className="p-3 flex gap-4">
              {exchangeStatuses.map(ex => (
                <div key={ex.exchange} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${ex.status === 'operational' ? 'bg-accent-green' : ex.status === 'degraded' ? 'bg-accent-amber' : 'bg-text-muted'}`} />
                  <span className="text-xs font-mono text-text-primary">{ex.exchange}</span>
                  <span className="text-xs text-text-muted">{ex.message}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-xs font-mono">
            <span className="text-text-muted">Category:</span>
            {categories.slice(0, 5).map(cat => (
              <button key={cat} onClick={() => setFilterCategory(cat)}
                className={`px-2 py-1 rounded capitalize ${filterCategory === cat ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>
                {cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs font-mono">
            <span className="text-text-muted">Direction:</span>
            {['all', 'bullish', 'bearish', 'neutral'].map(dir => (
              <button key={dir} onClick={() => setFilterDirection(dir)}
                className={`px-2 py-1 rounded capitalize ${filterDirection === dir ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>
                {dir}
              </button>
            ))}
          </div>
        </div>

        {/* News Feed */}
        <Panel title="News Feed" subtitle={`${filtered.length} events`}>
          {filtered.length === 0 ? (
            <div className="text-text-muted text-xs p-4 text-center">Loading news intelligence...</div>
          ) : (
            <div className="divide-y divide-border-dim/30">
              {filtered.map((event, i) => (
                <div key={i} className="p-3 hover:bg-bg-elevated">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted">{event.source}</span>
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                          event.direction === 'bullish' ? 'bg-data-bull/20 text-data-bull' :
                          event.direction === 'bearish' ? 'bg-data-bear/20 text-data-bear' :
                          'bg-bg-raised text-text-muted'
                        }`}>{event.direction}</span>
                        <span className="text-xs text-text-dim">{event.category}</span>
                      </div>
                      <p className="text-xs text-text-primary">{event.headline}</p>
                      {event.entities.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {event.entities.map(e => (
                            <span key={e} className="text-[8px] font-mono px-1 py-0.5 rounded bg-teal-vivid/10 text-teal-vivid">{e}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-text-dim">{new Date(event.publishedAt).toLocaleDateString()}</p>
                      <p className="text-xs text-text-muted">R:{(event.relevanceScore * 100).toFixed(0)}% S:{(event.severityScore * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </NexusLayout>
  )
}
