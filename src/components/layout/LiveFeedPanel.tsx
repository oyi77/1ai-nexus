"use client"

import { useState, useEffect, useCallback } from "react"

export type FeedCategory = 'all' | 'whale' | 'smart' | 'news' | 'macro' | 'signal'

export interface FeedItem {
  id: string
  time: string
  category: Exclude<FeedCategory, 'all'>
  icon: string
  message: string
  source?: string
}

const CATEGORY_CLASS: Record<string, string> = {
  whale:  'feed-whale',
  smart:  'feed-smart',
  news:   'feed-news',
  macro:  'feed-macro',
  signal: 'feed-signal',
}

const TABS: { key: FeedCategory; label: string }[] = [
  { key: 'all',    label: 'ALL' },
  { key: 'whale',  label: '🐋 WHALE' },
  { key: 'smart',  label: '🔥 SMART$' },
  { key: 'news',   label: '📰 NEWS' },
  { key: 'macro',  label: '📊 MACRO' },
  { key: 'signal', label: '🤖 SIGNAL' },
]

export function LiveFeedPanel() {
  const [activeTab, setActiveTab] = useState<FeedCategory>('all')
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchFeed = useCallback(async () => {
    try {
      const [newsRes, macroRes] = await Promise.allSettled([
        fetch('/api/v1/news?limit=20').then(r => r.json()),
        fetch('/api/v1/market/sentiment').then(r => r.json()),
      ])

      const feedItems: FeedItem[] = []

      if (newsRes.status === 'fulfilled' && newsRes.value?.items) {
        for (const n of newsRes.value.items.slice(0, 15)) {
          feedItems.push({
            id: n.id || String(Math.random()),
            time: formatTime(n.publishedAt || n.createdAt),
            category: n.category === 'macro' ? 'macro' : 'news',
            icon: n.category === 'macro' ? '📊' : '📰',
            message: n.title,
            source: n.sourceId,
          })
        }
      }

      if (macroRes.status === 'fulfilled' && macroRes.value?.fearGreed != null) {
        feedItems.push({
          id: 'fg-' + Date.now(),
          time: formatTime(new Date().toISOString()),
          category: 'macro',
          icon: '📊',
          message: `Fear & Greed Index: ${macroRes.value.fearGreed} (${macroRes.value.classification})`,
        })
      }

      if (feedItems.length === 0) {
        feedItems.push({
          id: 'init',
          time: formatTime(new Date().toISOString()),
          category: 'news',
          icon: '📰',
          message: 'Connecting to data modules...',
        })
      }

      setItems(feedItems)
    } catch {
      // Silent — keep existing items
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFeed()
    const id = setInterval(fetchFeed, 60_000)
    return () => clearInterval(id)
  }, [fetchFeed])

  const filtered = activeTab === 'all' ? items : items.filter(i => i.category === activeTab)

  return (
    <div className="flex flex-col h-full">
      {/* Category tabs */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-border-dim overflow-x-auto scrollbar-thin">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${
              activeTab === t.key
                ? 'bg-border-active text-text-primary'
                : 'text-text-dim hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Feed rows */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="p-4 text-text-dim text-xs text-center">Loading feed...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-text-dim text-xs text-center">No items in this category</div>
        ) : (
          filtered.map(item => (
            <div
              key={item.id}
              className="flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-bg-elevated cursor-pointer transition-colors border-b border-border-dim/30"
            >
              <span className="text-text-muted font-mono shrink-0 w-12">{item.time}</span>
              <span className="shrink-0">{item.icon}</span>
              <span className={`flex-1 leading-tight ${CATEGORY_CLASS[item.category] ?? 'text-text-primary'}`}>
                {item.message}
              </span>
              {item.source && (
                <span className="text-text-muted shrink-0 text-[10px]">{item.source}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '—:—'
  }
}
