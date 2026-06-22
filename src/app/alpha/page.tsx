"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface AlphaSignal {
  id: string
  type: string
  asset: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  headline: string
  explanation: string
  source: string
  sourceCountry?: string
  localOnlyScore?: number
  zScore?: number
  timestamp: string
  route?: string
}


const typeIcons: Record<string, string> = {
  smart_money: '🐋', gap: '📊', news: '📰', weather: '🌤️',
  liquidation: '⚡', new_listing: '🆕', correlation: '🔗',
}

const typeColors: Record<string, string> = {
  smart_money: 'text-data-purple', gap: 'text-data-orange', news: 'text-data-info',
  weather: 'text-teal-vivid', liquidation: 'text-data-bear', new_listing: 'text-data-bull',
  correlation: 'text-data-warn',
}

export default function AlphaFeedPage() {
  const { data, status, refresh } = useLiveFetch<AlphaSignal[]>({ url: '/api/v1/alpha-feed?limit=50', interval: 15_000 })
  const [filterType, setFilterType] = useState('all')
  const signals = data || []
  const filtered = filterType === 'all' ? signals : signals.filter(s => s.type === filterType)
  const types = ['all', ...new Set(signals.map(s => s.type))]

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Alpha Signal Feed</h1>
            <p className="text-[11px] text-text-muted font-mono">Unified intelligence — TradFi + on-chain + news + weather + microstructure</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-text-muted">{signals.length} signals</span>
            <LiveDot status={status} label />
          </div>
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1 text-[10px] font-mono overflow-x-auto">
          {types.map(t => (
            <button key={t} onClick={() => setFilterType(t)} className={`px-2 py-1 rounded whitespace-nowrap ${filterType === t ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}>
              {t === 'all' ? 'ALL' : `${typeIcons[t] || '•'} ${t.toUpperCase()}`}
            </button>
          ))}
        </div>

        {/* Signal Feed */}
        <Panel title="Live Alpha Signals" subtitle="Ranked by strength × confidence" liveStatus={status} onRefresh={refresh} maxHeight={700}>
          <div className="space-y-0">
            {filtered.map(signal => (
              <div key={signal.id} className="flex items-start gap-2 px-3 py-2 border-b border-bg-border/50 hover:bg-bg-raised/50 transition-colors">
                {/* Type icon */}
                <span className="text-[14px] mt-0.5 shrink-0">{typeIcons[signal.type] || '•'}</span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono ${typeColors[signal.type] || 'text-text-muted'}`}>{signal.type.toUpperCase()}</span>
                    <span className="text-[10px] font-mono text-text-muted">{signal.source}</span>
                    {signal.localOnlyScore && signal.localOnlyScore > 50 && (
                      <span className="px-1 py-0 rounded bg-data-orange/20 text-data-orange text-[9px] font-mono">🔥 LOCAL EXCLUSIVE</span>
                    )}
                    {signal.zScore && Math.abs(signal.zScore) > 2 && (
                      <span className="px-1 py-0 rounded bg-data-warn/20 text-data-warn text-[9px] font-mono">Z={signal.zScore.toFixed(1)}</span>
                    )}
                  </div>
                  <div className="text-[12px] font-medium text-text-primary mt-0.5">{signal.headline}</div>
                  {signal.explanation && <div className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{signal.explanation}</div>}
                </div>

                {/* Strength & Direction */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className={`text-[12px] font-mono font-bold ${
                    signal.direction === 'bullish' ? 'text-data-bull' :
                    signal.direction === 'bearish' ? 'text-data-bear' : 'text-data-neutral'
                  }`}>
                    {signal.direction === 'bullish' ? '▲' : signal.direction === 'bearish' ? '▼' : '—'} {signal.asset}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-mono text-text-muted">STR</span>
                    <span className="text-[10px] font-mono text-text-primary">{signal.strength}</span>
                    <span className="text-[9px] font-mono text-text-muted">CONF</span>
                    <span className="text-[10px] font-mono text-text-primary">{Math.round(signal.confidence * 100)}%</span>
                  </div>
                  <span className="text-[9px] font-mono text-text-muted">{new Date(signal.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="p-8 text-center text-text-muted text-[11px]">
                {signals.length === 0 ? 'Loading signals...' : 'No signals matching filter'}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
