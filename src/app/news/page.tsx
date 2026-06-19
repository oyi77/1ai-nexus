"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"

interface NewsItem {
  id: string
  title: string
  url: string
  sourceId: string
  publishedAt: string
  summary?: string
  category: string
}

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("all")

  useEffect(() => {
    fetch(`/api/v1/news?limit=50${filter !== 'all' ? `&category=${filter}` : ''}`)
      .then(r => r.json())
      .then(d => { setItems(d.items ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filter])

  return (
    <TerminalShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">NEWS FEED</h1>
          <div className="flex gap-2">
            {['all', 'crypto', 'macro', 'regulatory', 'tradfi'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  filter === f
                    ? 'bg-border-active border-border-active text-text-primary'
                    : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-text-dim text-xs">Loading news...</div>
        ) : items.length === 0 ? (
          <div className="text-text-dim text-xs">No news items found</div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div key={item.id} className="bg-bg-panel border border-border-dim rounded-lg p-3 hover:border-border-active transition-colors">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
                  <p className="text-sm text-text-primary hover:text-accent-cyan transition-colors">{item.title}</p>
                  {item.summary && (
                    <p className="text-xs text-text-dim mt-1 line-clamp-2">{item.summary}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-accent-cyan font-mono">{item.sourceId}</span>
                    <span className="text-[10px] text-text-muted">{formatDate(item.publishedAt)}</span>
                    <span className="text-[10px] text-text-muted bg-bg-elevated px-1 rounded">{item.category}</span>
                  </div>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </TerminalShell>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}
