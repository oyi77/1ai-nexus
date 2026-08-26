"use client";

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

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
            <p className="text-xs text-text-muted">Market sentiment composite</p>
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
                {d.categories && (Array.isArray(d.categories) ? d.categories : Object.entries(d.categories).map(([name, cat]) => ({ name, ...(cat as { score: number; weight: number }) }))).map((cat, i) => (
                  <div key={i} className="bg-bg-raised rounded p-3">
                    <div className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">{cat.name}</div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[20px] font-head font-bold tabular-nums ${scoreColor(cat.score)}`}>{cat.score}</span>
                      <span className="text-xs text-text-muted font-mono">×{cat.weight}</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-bg-border rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${cat.score > 50 ? 'bg-data-bull' : cat.score > 30 ? 'bg-data-warn' : 'bg-data-bear'}`} style={{ width: `${cat.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="History" subtitle={`${d.history?.length ?? 0} data points`}>
              <div className="p-3" style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.history ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="fgGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6b7280' }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#6b7280' }} width={30} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6, fontSize: 11, fontFamily: 'monospace' }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(value: unknown) => [String(value), 'Score']}
                    />
                    <Area type="monotone" dataKey="score" stroke="#14b8a6" fill="url(#fgGradient)" strokeWidth={2} dot={{ r: 3, fill: '#14b8a6' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

          </>
        )}
      </div>
    </NexusLayout>
  )
}
