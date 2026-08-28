"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface NewsItem {
  id: string
  title: string
  url: string
  sourceId: string
  publishedAt: string
  summary?: string
  category: string
}

const CATEGORIES = ['All', 'breaking', 'markets', 'defi', 'nfts', 'regulation', 'technology', 'opinion', 'onchain']

export function NewsFeedContent() {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const fetchNews = async (category?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (category && category !== 'All') params.set('category', category)
      const res = await fetch(`/api/v1/news?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setNews(data.data?.items ?? [])
      setLastFetch(new Date())
      setLoading(false)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNews(filter === 'All' ? undefined : filter)
    // Refresh every 60 seconds
    const interval = setInterval(() => fetchNews(filter === 'All' ? undefined : filter), 60000)
    return () => clearInterval(interval)
  }, [filter])

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">NEWS FEED</h1>
          <p className="text-xs text-text-muted mt-1">
            {news.length} articles · 30+ RSS sources · Auto-refresh 60s
            {lastFetch && ` · Last: ${lastFetch.toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
          <button onClick={() => fetchNews(filter === 'All' ? undefined : filter)}
            className="px-2 py-1 text-xs font-mono bg-bg-panel border border-border-dim rounded text-text-muted hover:border-border-active">
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-data-bear text-xs font-mono p-4 bg-bg-panel border border-border-dim rounded">
          Error: {error}
        </div>
      )}

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => setFilter(cat)}
            className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
              filter === cat
                ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
            }`}>
            {cat}
          </button>
        ))}
      </div>

      {/* News Feed */}
      {loading && news.length === 0 ? (
        <div className="text-text-dim text-xs p-8 text-center">Loading news from RSS feeds...</div>
      ) : news.length === 0 ? (
        <div className="text-text-dim text-xs p-8 text-center">No news articles found</div>
      ) : (
        <div className="space-y-2">
          {news.map(item => (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
              className="block bg-bg-panel border border-border-dim rounded-lg p-3 hover:border-border-active transition-colors">
              <div className="flex items-start justify-between mb-1">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-bg-elevated text-accent-cyan">
                  {item.sourceId}
                </span>
                <span className="text-xs font-mono text-text-muted">
                  {item.publishedAt ? new Date(item.publishedAt).toLocaleString() : '—'}
                </span>
              </div>
              <h3 className="text-xs text-text-primary mb-1">{item.title}</h3>
              {item.summary && (
                <p className="text-xs text-text-dim line-clamp-2">{item.summary}</p>
              )}
              <span className="text-xs font-mono text-text-muted mt-1 inline-block">{item.category}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}


