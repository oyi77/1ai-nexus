"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface ComponentScore {
  score: number
  signals: string[]
}

interface CompositeSignal {
  id: string
  name: string
  description: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  components: Array<{ module: string; metric: string; value: number | string; weight: number; contribution: number }>
}

interface IntelScore {
  overall: number
  grade: string
  regime: string
  components: {
    derivatives: ComponentScore
    macro: ComponentScore
    sentiment: ComponentScore
    onChain: ComponentScore
  }
  compositeSignals: CompositeSignal[]
}

function ScoreGauge({ score, label, size = 120 }: { score: number; label: string; size?: number }) {
  const radius = (size - 20) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444'

  return (
    <div className="flex flex-col items-center relative">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-2xl font-mono font-bold" style={{ color }}>{score}</span>
        <span className="text-[9px] text-text-muted font-mono">{label}</span>
      </div>
    </div>
  )
}

function DirectionBadge({ direction }: { direction: string }) {
  const color = direction === 'bullish' ? 'bg-data-bull/20 text-data-bull' : direction === 'bearish' ? 'bg-data-bear/20 text-data-bear' : 'bg-bg-raised text-text-muted'
  return <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${color}`}>{direction}</span>
}

export default function IntelligenceScorePage() {
  const [data, setData] = useState<IntelScore | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/intelligence-score')
        const d = await res.json()
        if (d.data) setData(d.data)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <NexusLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted font-mono text-sm">Computing intelligence score...</div>
        </div>
      </NexusLayout>
    )
  }

  if (!data) {
    return (
      <NexusLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-data-bear font-mono text-sm">Failed to compute intelligence score</div>
        </div>
      </NexusLayout>
    )
  }

  const gradeColor = data.grade.startsWith('A') ? '#22c55e' : data.grade.startsWith('B') ? '#3b82f6' : data.grade.startsWith('C') ? '#eab308' : '#ef4444'
  const regimeColor = data.regime === 'bullish' ? '#22c55e' : data.regime === 'bearish' ? '#ef4444' : '#eab308'

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">INTELLIGENCE SCORE</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Unified score combining all 14 intelligence modules
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Main Score */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <div className="flex items-center justify-center gap-8">
            <div className="relative">
              <ScoreGauge score={data.overall} label="OVERALL" size={160} />
            </div>
            <div className="text-center">
              <p className="text-6xl font-mono font-bold" style={{ color: gradeColor }}>{data.grade}</p>
              <p className="text-sm font-mono mt-1" style={{ color: regimeColor }}>
                {data.regime.toUpperCase()} REGIME
              </p>
            </div>
          </div>
        </div>

        {/* Component Scores */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([['derivatives', 'Derivatives'], ['macro', 'Macro'], ['sentiment', 'Sentiment'], ['onChain', 'On-Chain']] as const).map(([key, label]) => {
            const comp = data.components[key]
            return (
              <Panel key={key} title={label} subtitle={`Score: ${comp.score}`}>
                <div className="p-3">
                  <div className="relative flex justify-center mb-2">
                    <ScoreGauge score={comp.score} label={label} size={90} />
                  </div>
                  <div className="space-y-1 mt-2">
                    {comp.signals.length === 0 ? (
                      <p className="text-[10px] text-text-dim">No signals detected</p>
                    ) : (
                      comp.signals.map((s, i) => (
                        <p key={i} className="text-[10px] text-text-dim">{s}</p>
                      ))
                    )}
                  </div>
                </div>
              </Panel>
            )
          })}
        </div>

        {/* Composite Signals */}
        <Panel title="Composite Signals" subtitle={`${data.compositeSignals.length} cross-module signals`}>
          <div className="p-4 space-y-4">
            {data.compositeSignals.map(signal => (
              <div key={signal.id} className="bg-bg-elevated rounded-lg p-4 border border-border-dim/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-mono font-bold">{signal.name}</h3>
                    <DirectionBadge direction={signal.direction} />
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono text-text-muted">Strength: {signal.strength}%</p>
                  </div>
                </div>
                <p className="text-[10px] text-text-dim mb-3">{signal.description}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {signal.components.map((c, i) => (
                    <div key={i} className="bg-bg-panel rounded p-2 border border-border-dim/20">
                      <p className="text-[9px] text-text-muted font-mono">{c.module} / {c.metric}</p>
                      <p className="text-xs font-mono font-bold">{typeof c.value === 'number' ? c.value.toFixed(2) : c.value}</p>
                      <p className={`text-[9px] font-mono ${c.contribution > 0 ? 'text-data-bull' : c.contribution < 0 ? 'text-data-bear' : 'text-text-dim'}`}>
                        {c.contribution > 0 ? '+' : ''}{c.contribution.toFixed(0)} contribution
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Score Methodology */}
        <Panel title="Methodology" subtitle="How the intelligence score is computed">
          <div className="p-4 text-xs text-text-dim space-y-2">
            <p><strong className="text-text-primary">Overall Score:</strong> Weighted average of 4 components (each 25%): Derivatives, Macro, Sentiment, On-Chain.</p>
            <p><strong className="text-text-primary">Derivatives:</strong> Funding rates, open interest, long/short ratios from Binance/Bybit/OKX.</p>
            <p><strong className="text-text-primary">Macro:</strong> ETF flows (BTC/ETH spot ETFs), Coinbase/Korea premiums, futures basis.</p>
            <p><strong className="text-text-primary">Sentiment:</strong> Fear &amp; Greed Index, Google Trends proxy, Reddit velocity, narrative rotation.</p>
            <p><strong className="text-text-primary">On-Chain:</strong> ETH staking queue, miner hash rate, DeFi credit stress, whale activity.</p>
            <p><strong className="text-text-primary">Composite Signals:</strong> Cross-module rules that combine multiple data points into actionable signals.</p>
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
