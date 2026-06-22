"use client"

import { LiveDot } from '../primitives/LiveDot'
import { RefreshCw } from 'lucide-react'
import { useState, useCallback } from 'react'

interface PanelProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode[]
  liveStatus?: 'live' | 'stale' | 'error' | 'disconnected'
  onRefresh?: () => void
  className?: string
  children: React.ReactNode
  maxHeight?: number | string
}

export function Panel({
  title,
  subtitle,
  actions = [],
  liveStatus,
  onRefresh,
  className = '',
  children,
  maxHeight,
}: PanelProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return
    setRefreshing(true)
    await onRefresh()
    setTimeout(() => setRefreshing(false), 500)
  }, [onRefresh])

  return (
    <div
      role="region"
      aria-label={title}
      className={`flex flex-col bg-bg-panel border border-bg-border overflow-hidden ${className}`}
      style={{ maxHeight: maxHeight || undefined }}
    >

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {liveStatus && <LiveDot status={liveStatus} size={5} />}
          <h3 className="text-[13px] font-medium text-text-primary truncate font-sans">
            {title}
          </h3>
          {subtitle && (
            <span className="text-[10px] text-text-muted font-mono hidden sm:inline">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRefresh && (
            <button
              onClick={handleRefresh}
              className="p-1 rounded hover:bg-bg-raised transition-colors text-text-muted hover:text-text-secondary"
              title="Refresh"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
          {actions.map((action, i) => (
            <span key={i}>{action}</span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {children}
      </div>
    </div>
  )
}
