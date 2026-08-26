"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface SignalComponent {
  module: string
  metric: string
  value: number | string
  weight: number
  contribution: number
}

interface CompositeSignal {
  id: string
  name: string
  description: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  components: SignalComponent[]
  timestamp: string
}

export default function CompositeAlertsPage() {
  const [signals, setSignals] = useState<CompositeSignal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/composite-alerts')
        const d = await res.json()
        if (d.data?.signals) setSignals(d.data.signals)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 300_000)
    return () => clearInterval(interval)
  }, [])

  const bullish = signals.filter(s => s.direction === 'bullish')
  const bearish = signals.filter(s => s.direction === 'bearish')
  const neutral = signals.filter(s => s.direction === 'neutral')

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">COMPOSITE SIGNALS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Cross-module compound signals — ETF + derivatives + sentiment + credit + miner + narrative
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-panel border border-data-bull/30 rounded-lg p-3 text-center">
            <p className="text-[10px] text-text-muted font-mono">BULLISH</p>
            <p className="text-2xl font-mono font-bold text-data-bull">{bullish.length}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-center">
            <p className="text-[10px] text-text-muted font-mono">NEUTRAL</p>
            <p className="text-2xl font-mono font-bold text-text-muted">{neutral.length}</p>
          </div>
          <div className="bg-bg-panel border border-data-bear/30 rounded-lg p-3 text-center">
            <p className="text-[10px] text-text-muted font-mono">BEARISH</p>
            <p className="text-2xl font-mono font-bold text-data-bear">{bearish.length}</p>
          </div>
        </div>

        {/* Signal cards */}
        {signals.length === 0 ? (
          <Panel title="No Active Signals" subtitle="Composite evaluator found no compound signals">
            <div className="text-text-muted text-[11px] p-4 text-center">
              No cross-module confluence detected — neutral conditions
            </div>
          </Panel>
        ) : (
          <div className="space-y-3">
            {signals.map((signal) => (
              <Panel key={signal.id} title={signal.name} subtitle={signal.description}>
                <div className="p-4 space-y-3">
                  {/* Direction + strength bar */}
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-mono px-2 py-1 rounded font-bold ${
                      signal.direction === 'bullish' ? 'bg-data-bull/20 text-data-bull' :
                      signal.direction === 'bearish' ? 'bg-data-bear/20 text-data-bear' :
                      'bg-bg-raised text-text-muted'
                    }`}>
                      {signal.direction.toUpperCase()}
                    </span>
                    <div className="flex-1 h-2 bg-bg-raised rounded overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          signal.direction === 'bullish' ? 'bg-data-bull' :
                          signal.direction === 'bearish' ? 'bg-data-bear' :
                          'bg-text-muted'
                        }`}
                        style={{ width: `${signal.strength}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono font-bold">{signal.strength}/100</span>
                  </div>

                  {/* Component breakdown */}
                  <div className="space-y-1">
                    {signal.components.map((comp, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-text-dim">{comp.module}</span>
                          <span className="text-text-muted">/</span>
                          <span className="font-mono">{comp.metric}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-text-dim">{typeof comp.value === 'number' ? comp.value.toFixed(4) : comp.value}</span>
                          <span className="text-text-muted">w:{comp.weight}</span>
                          <span className={`font-mono font-bold ${
                            comp.contribution > 0 ? 'text-data-bull' : comp.contribution < 0 ? 'text-data-bear' : 'text-text-muted'
                          }`}>
                            {comp.contribution > 0 ? '+' : ''}{comp.contribution}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
