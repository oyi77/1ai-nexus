"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface FearGreedResponse {
  composite: { score: number; label: string }
  categories: Array<{ name: string; score: number; weight: number }>
  regime?: { state: string; stance: string }
  history?: Array<{ date: string; score: number }>
}

const scoreColor = (s: number) => s <= 25 ? 'text-data-bear' : s <= 45 ? 'text-data-warn' : s <= 55 ? 'text-data-neutral' : s <= 75 ? 'text-data-bull' : 'text-teal-vivid'
const scoreLabel = (s: number) => s <= 25 ? 'Extreme Fear' : s <= 45 ? 'Fear' : s <= 55 ? 'Neutral' : s <= 75 ? 'Greed' : 'Extreme Greed'

export default function FearGreedPage() {
  const { data: resp, status } = useLiveFetch<FearGreedResponse>({ url: '/api/v1/fear-greed', interval: 60_000 })
  const d = resp

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Fear & Greed Index</h1>
            <p className="text-[11px] text-text-muted font-mono">Market sentiment composite</p>
          </div>
          <LiveDot status={status} label />
        </div>

        {d && (
          <>
            <Panel title="Current Reading" subtitle={d.regime?.state}>
              <div className="p-6 text-center">
                <div className={`text-[64px] font-head font-bold tabular-nums ${scoreColor(d.composite.score)}`}>{d.composite.score}</div>
                <div className={`text-[18px] font-head ${scoreColor(d.composite.score)}`}>{scoreLabel(d.composite.score)}</div>
                {d.regime && <div className="mt-2 text-[12px] font-mono text-text-secondary">Regime: {d.regime.state} · Stance: {d.regime.stance}</div>}
              </div>
            </Panel>

            <Panel title="Category Breakdown" subtitle="Component scores">
              <div className="p-3 grid grid-cols-2 lg:grid-cols-3 gap-2">
                {d.categories && Object.entries(d.categories).map(([name, cat]) => (
                  <div key={name} className="bg-bg-raised rounded p-3">
                    <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">{name}</div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[20px] font-head font-bold tabular-nums ${scoreColor(cat.score)}`}>{cat.score}</span>
                      <span className="text-[10px] text-text-muted font-mono">×{cat.weight}</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-bg-border rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${cat.score > 50 ? 'bg-data-bull' : cat.score > 30 ? 'bg-data-warn' : 'bg-data-bear'}`} style={{ width: `${cat.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {d.history && d.history.length > 0 && (
              <Panel title="7-Day History">
                <div className="p-3 flex items-end gap-1 h-24">
                  {d.history.map((h, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[9px] font-mono text-text-muted">{h.score}</div>
                      <div className={`w-full rounded-t ${scoreColor(h.score).replace('text-', 'bg-')}`} style={{ height: `${h.score}%` }} />
                      <div className="text-[8px] font-mono text-text-muted">{h.date.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}
      </div>
    </NexusLayout>
  )
}
