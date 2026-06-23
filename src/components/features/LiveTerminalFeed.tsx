"use client"

import { useState, useEffect, useRef } from 'react'

interface FeedItem {
  id: string
  timestamp: string
  source: string
  type: 'whale' | 'news' | 'signal' | 'dex' | 'liquidation' | 'alert'
  headline: string
  detail?: string
  link?: string
  usd?: number
}

function typeIcon(type: FeedItem['type']): string {
  switch (type) {
    case 'whale': return '🐋'
    case 'news': return '📰'
    case 'signal': return '⚡'
    case 'dex': return '🔥'
    case 'liquidation': return '💥'
    case 'alert': return '🚨'
    default: return '•'
  }
}

function typeColor(type: FeedItem['type']): string {
  switch (type) {
    case 'whale': return 'text-teal-vivid'
    case 'news': return 'text-text-primary'
    case 'signal': return 'text-accent-amber'
    case 'dex': return 'text-data-bull'
    case 'liquidation': return 'text-data-bear'
    case 'alert': return 'text-data-bear'
    default: return 'text-text-muted'
  }
}

export function LiveTerminalFeed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [paused, setPaused] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchFeed = async () => {
      try {
        const [whaleRes, newsRes, alphaRes, dexRes] = await Promise.allSettled([
          fetch('/api/v1/whale-alert').then(r => r.json()),
          fetch('/api/v1/news?category=crypto&limit=5').then(r => r.json()),
          fetch('/api/v1/alpha-feed?limit=5').then(r => r.json()),
          fetch('/api/v1/dex/trending?network=solana&limit=3').then(r => r.json()),
        ])

        const newItems: FeedItem[] = []

        // Whale alerts
        if (whaleRes.status === 'fulfilled' && whaleRes.value?.data?.items) {
          for (const w of whaleRes.value.data.items.slice(0, 5)) {
            newItems.push({
              id: String(w.id ?? `wa-${Date.now()}`),
              timestamp: new Date().toLocaleTimeString(),
              source: 'Whale Alert',
              type: 'whale',
              headline: `${Number(w.amount ?? 0).toLocaleString()} ${String(w.symbol ?? '')} ($${(Number(w.usd ?? 0) / 1e6).toFixed(1)}M): ${String(w.from ?? '')} → ${String(w.to ?? '')}`,
              link: w.link ? String(w.link) : undefined,
              usd: Number(w.usd ?? 0),
            })
          }
        }

        // News
        if (newsRes.status === 'fulfilled' && newsRes.value?.data?.items) {
          for (const n of newsRes.value.data.items.slice(0, 3)) {
            newItems.push({
              id: String(n.id ?? `news-${Date.now()}`),
              timestamp: new Date(n.publishedAt ?? Date.now()).toLocaleTimeString(),
              source: String(n.sourceId ?? 'news'),
              type: 'news',
              headline: String(n.title ?? ''),
              link: n.url ? String(n.url) : undefined,
            })
          }
        }

        // Alpha signals
        if (alphaRes.status === 'fulfilled' && Array.isArray(alphaRes.value?.data)) {
          for (const s of alphaRes.value.data.slice(0, 3)) {
            newItems.push({
              id: String(s.id ?? `sig-${Date.now()}`),
              timestamp: s.timestamp ? new Date(s.timestamp as string).toLocaleTimeString() : new Date().toLocaleTimeString(),
              source: 'Alpha Engine',
              type: 'signal',
              headline: String(s.headline ?? ''),
              detail: s.asset ? String(s.asset) : undefined,
            })
          }
        }

        // DEX trending
        if (dexRes.status === 'fulfilled' && dexRes.value?.data?.items) {
          for (const d of dexRes.value.data.items.slice(0, 3)) {
            newItems.push({
              id: `dex-${d.address ?? Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              source: 'DEX Scanner',
              type: 'dex',
              headline: `${String(d.name ?? '')} — Vol: $${(Number(d.volume24h ?? 0) / 1e6).toFixed(1)}M, FDV: $${(Number(d.fdv ?? 0) / 1e6).toFixed(1)}M`,
              usd: Number(d.volume24h ?? 0),
            })
          }
        }

        // Sort by USD value (biggest first) and deduplicate
        newItems.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
        
        setItems(prev => {
          const existing = new Set(prev.map(i => i.headline))
          const fresh = newItems.filter(i => !existing.has(i.headline))
          return [...fresh, ...prev].slice(0, 100)
        })
      } catch {
        // Silent fail
      }
    }

    fetchFeed()
    const id = setInterval(fetchFeed, 15_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!paused && feedRef.current) {
      feedRef.current.scrollTop = 0
    }
  }, [items, paused])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-data-bull animate-pulse" />
          <span className="text-[11px] font-mono font-bold text-text-primary">LIVE FEED</span>
          <span className="text-[10px] font-mono text-text-muted">{items.length} events</span>
        </div>
        <button
          onClick={() => setPaused(!paused)}
          className={`text-[10px] font-mono px-2 py-0.5 rounded ${paused ? 'bg-data-bear/20 text-data-bear' : 'bg-data-bull/20 text-data-bull'}`}
        >
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
      </div>
      <div ref={feedRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {items.map((item, i) => (
          <div
            key={`${item.id}-${i}`}
            className="flex items-start gap-2 px-3 py-1.5 border-b border-bg-border/50 hover:bg-bg-raised transition-colors"
          >
            <span className="text-[10px] font-mono text-text-muted w-16 shrink-0 tabular-nums">{item.timestamp}</span>
            <span className="text-[12px] shrink-0">{typeIcon(item.type)}</span>
            <div className="flex-1 min-w-0">
              <span className={`text-[11px] font-mono ${typeColor(item.type)} break-words`}>
                {item.link ? (
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.headline}</a>
                ) : item.headline}
              </span>
              {item.detail && <span className="text-[10px] font-mono text-teal-vivid ml-2">{item.detail}</span>}
            </div>
            <span className="text-[9px] font-mono text-text-muted uppercase shrink-0">{item.source}</span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="flex items-center justify-center h-full text-[11px] font-mono text-text-muted">
            Aggregating live data from all sources...
          </div>
        )}
      </div>
    </div>
  )
}
