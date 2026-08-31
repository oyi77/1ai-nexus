'use client'

import { useEffect, useState, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { Flame, RefreshCw } from 'lucide-react'

interface ConvictionReason {
  text: string
  weight: number
}

interface ConvictionItem {
  symbol: string
  name: string
  price: number
  changePct: number
  conviction: number
  action: 'BUY' | 'WAIT' | 'SELL'
  direction: 'bull' | 'bear' | 'neutral'
  reasons: ConvictionReason[]
  sources: string[]
}

interface ConvictionMarket {
  id: string
  label: string
  items: ConvictionItem[]
}

interface ConvictionResult {
  generated: string
  markets: ConvictionMarket[]
}

function actionColor(action: string): string {
  if (action === 'BUY') return 'bg-data-bull/20 text-data-bull'
  if (action === 'SELL') return 'bg-data-bear/20 text-data-bear'
  return 'bg-amber-500/20 text-amber-400'
}

function barColor(conviction: number): string {
  if (conviction >= 65) return 'bg-data-bull'
  if (conviction < 35) return 'bg-data-bear'
  return 'bg-amber-500'
}

function weightDots(weight: number): number {
  if (weight > 0.3) return 3
  if (weight > 0.2) return 2
  return 1
}

function ConvictionCard({ item }: { item: ConvictionItem }) {
  return (
    <div className="bg-bg-raised rounded-lg p-4 border border-bg-border hover:border-border-active transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-head font-bold text-text-primary">{item.symbol}</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${actionColor(item.action)}`}>
              {item.action}
            </span>
          </div>
          <p className="text-xs text-text-muted truncate mt-0.5">{item.name}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono font-bold text-text-primary tabular-nums">${item.price?.toLocaleString() ?? '—'}</p>
          <p className={`text-xs font-mono tabular-nums ${item.changePct >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
            {item.changePct >= 0 ? '+' : ''}{item.changePct?.toFixed(2) ?? '0.00'}%
          </p>
        </div>
      </div>

      {/* Conviction bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] font-mono text-text-muted mb-1">
          <span>CONVICTION</span>
          <span className="text-text-primary font-bold">{item.conviction ?? 0}/100</span>
        </div>
        <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor(item.conviction ?? 0)}`}
            style={{ width: `${Math.max(2, Math.min(100, item.conviction ?? 0))}%` }}
          />
        </div>
      </div>

      {/* Reasons */}
      {item.reasons && item.reasons.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {item.reasons.slice(0, 3).map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${barColor(item.conviction ?? 0)}`} />
              <p className="text-xs text-text-secondary leading-snug">{r.text}</p>
              <span className="ml-auto flex gap-0.5 shrink-0 mt-1.5">
                {Array.from({ length: 3 }).map((_, d) => (
                  <span key={d} className={`w-1 h-1 rounded-full ${d < weightDots(r.weight) ? 'bg-teal-vivid' : 'bg-bg-border'}`} />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Source chips */}
      {item.sources && item.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {item.sources.map((s) => (
            <span key={s} className="text-[9px] font-mono uppercase text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function IntelligencePage() {
  const [data, setData] = useState<ConvictionResult | null>(null)
  const [filter, setFilter] = useState<'All' | 'IDX' | 'CRYPTO'>('All')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchConviction = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/conviction')
      const json = await res.json()
      const d = json?.data ?? json
      if (d?.markets) {
        setData(d)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConviction()
    const id = setInterval(fetchConviction, 60_000)
    return () => clearInterval(id)
  }, [fetchConviction])

  const allItems = data ? data.markets.flatMap((m) => m.items) : []
  const filtered = filter === 'All'
    ? allItems
    : (data?.markets.find((m) => m.id === filter)?.items ?? [])
  const sorted = [...filtered].sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0))

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary flex items-center gap-2">
              <Flame size={18} className="text-teal-vivid" /> Market Intelligence
            </h1>
            <p className="text-xs text-text-muted mt-1">
              {data?.generated ? `Updated ${new Date(data.generated).toLocaleTimeString()}` : 'Cross-asset conviction signals'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot status={status} size={6} />
            <button onClick={fetchConviction} className="p-1.5 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Market filter */}
        <div className="flex flex-wrap gap-2">
          {(['All', 'IDX', 'CRYPTO'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
                filter === f
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-bg-border text-text-muted hover:text-text-primary'
              }`}
            >
              {f === 'IDX' ? 'Indonesia Equities' : f === 'CRYPTO' ? 'Crypto' : 'All'}
            </button>
          ))}
        </div>

        {/* Cards */}
        {status === 'error' && (
          <div className="text-center py-12 text-sm text-data-bear">Failed to load intelligence</div>
        )}
        {sorted.length === 0 && status === 'live' && (
          <div className="text-center py-12 text-sm text-text-muted">No signals right now</div>
        )}
        {sorted.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sorted.map((item) => (
              <ConvictionCard key={`${item.symbol}-${item.direction}`} item={item} />
            ))}
          </div>
        )}
      </div>
    </NexusLayout>
  )
}