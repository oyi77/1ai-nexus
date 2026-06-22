"use client"

import { useState, useEffect, useCallback } from 'react'
import { Bell, X } from 'lucide-react'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface AlphaSignal {
  id: string
  type: string
  asset: string
  direction: string
  strength: number
  headline: string
  timestamp: string
  route?: string
}

interface AlphaFeedResponse { data: AlphaSignal[] }

const typeIcons: Record<string, string> = {
  smart_money: '🐋', gap: '📊', news: '📰', weather: '🌤️',
  liquidation: '⚡', new_listing: '🆕', correlation: '🔗',
}

export function NotificationTray() {
  const [isOpen, setIsOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const { data } = useLiveFetch<AlphaFeedResponse>({ url: '/api/v1/alpha-feed?limit=10', interval: 30_000 })
  const notifications = data?.data || []

  useEffect(() => {
    const mark = () => { if (notifications.length > 0) setHasUnread(true) }
    mark()
  }, [notifications.length])

  const handleClick = useCallback(() => {
    setIsOpen(!isOpen)
    if (!isOpen) setHasUnread(false)
  }, [isOpen])

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className="relative p-1.5 rounded hover:bg-bg-raised transition-colors"
      >
        <Bell size={14} className="text-text-muted" />
        {hasUnread && notifications.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-data-bear text-[8px] text-white flex items-center justify-center">
            {Math.min(notifications.length, 9)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-bg-panel border border-bg-border rounded shadow-lg z-50 max-h-96 overflow-auto scrollbar-thin">
          <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
            <span className="text-[11px] font-mono font-medium text-text-primary">Notifications</span>
            <button onClick={() => setIsOpen(false)} className="text-text-muted hover:text-text-secondary">
              <X size={12} />
            </button>
          </div>

          {notifications.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-[11px]">No recent signals</div>
          ) : (
            notifications.map(n => (
              <a
                key={n.id}
                href={n.route || '#'}
                className="block px-3 py-2 border-b border-bg-border/50 hover:bg-bg-raised/50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[12px] mt-0.5">{typeIcons[n.type] || '•'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-text-primary line-clamp-2">{n.headline}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] font-mono ${n.direction === 'bullish' ? 'text-data-bull' : n.direction === 'bearish' ? 'text-data-bear' : 'text-data-neutral'}`}>
                        {n.direction?.toUpperCase()}
                      </span>
                      <span className="text-[9px] font-mono text-text-muted">{new Date(n.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  )
}
