"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface TierScore {
  tier: string
  score: number
  confidence: number
  signalCount: number
  topSignal: string
}

interface MarketScore {
  symbol: string
  compositeScore: number
  direction: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  tierScores: TierScore[]
  topSignals: string[]
  fetchedAt: string
}

const TIER_LABELS: Record<string, { label: string; icon: string }> = {
  positioning: { label: 'Positioning', icon: '📊' },
  onchain: { label: 'On-Chain', icon: '⛓️' },
  sentiment: { label: 'Sentiment', icon: '🎭' },
  macro: { label: 'Macro', icon: '🌍' },
  structure: { label: 'Structure', icon: '🏗️' },
}

export default function MarketScorePage() {
  const [scores, setScores] = useState<MarketScore[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [loading, setLoading] = useState(true)

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/market-score')
      const data = await res.json()
      setScores(data.data?.scores ?? [])
      setStatus('live')
      setLoading(false)
    } catch {
      setStatus('error')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchScores()
    const id = setInterval(fetchScores, 60_000) // Refresh every minute
    return () => clearInterval(id)
  }, [fetchScores])

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-data-bull'
    if (score <= 30) return 'text-data-bear'
    return 'text-data-orange'
  }

  const getDirectionEmoji = (direction: string) => {
    if (direction === 'bullish') return '🟢'
    if (direction === 'bearish') return '🔴'
    return '⚪'
  }

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">📡</span> Market-Moving Score
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Composite score from 10+ data sources · Positioning + On-Chain + Sentiment + Macro
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Score Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {scores.map((score) => (
            <div
              key={score.symbol}
              className="bg-bg-panel border border-border-dim rounded-lg p-4 hover:border-teal-vivid/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-mono font-bold text-teal-vivid">{score.symbol}</span>
                <span className="text-[18px]">{getDirectionEmoji(score.direction)}</span>
              </div>
              <div className={`text-[28px] font-mono font-bold ${getScoreColor(score.compositeScore)}`}>
                {score.compositeScore}
              </div>
              <div className="text-[10px] font-mono text-text-muted mt-1">
                {score.direction.toUpperCase()} · {(score.confidence * 100).toFixed(0)}% conf
              </div>
            </div>
          ))}
        </div>

        {/* Detailed View for BTC */}
        {scores.length > 0 && scores[0] && (
          <Panel title={`${scores[0].symbol} — Market-Moving Analysis`} subtitle={`Composite Score: ${scores[0].compositeScore}`} liveStatus={status} onRefresh={fetchScores}>
            <div className="p-4 space-y-4">
              {/* Tier Breakdown */}
              <div className="grid grid-cols-5 gap-3">
                {scores[0].tierScores.map((tier) => {
                  const meta = TIER_LABELS[tier.tier] ?? { label: tier.tier, icon: '📈' }
                  return (
                    <div key={tier.tier} className="bg-bg-raised rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span>{meta.icon}</span>
                        <span className="text-[11px] font-mono text-text-muted">{meta.label}</span>
                      </div>
                      <div className={`text-[20px] font-mono font-bold ${getScoreColor(tier.score)}`}>
                        {tier.score}
                      </div>
                      <div className="text-[9px] font-mono text-text-muted mt-1">
                        {tier.signalCount} signals · {(tier.confidence * 100).toFixed(0)}% conf
                      </div>
                      {tier.topSignal && (
                        <div className="text-[9px] font-mono text-text-secondary mt-2 line-clamp-2">
                          {tier.topSignal}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Top Signals */}
              <div>
                <h3 className="text-[11px] font-mono text-accent-cyan mb-2">TOP SIGNALS</h3>
                <div className="space-y-1">
                  {scores[0].topSignals.map((signal, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] font-mono text-text-secondary">
                      <span className="text-teal-vivid">{i + 1}.</span>
                      {signal}
                    </div>
                  ))}
                </div>
              </div>

              {/* Updated */}
              <div className="text-[9px] font-mono text-text-muted">
                Updated: {new Date(scores[0].fetchedAt).toLocaleTimeString()}
              </div>
            </div>
          </Panel>
        )}

        {/* How it works */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h3 className="text-[11px] font-mono text-accent-cyan mb-3">HOW IT WORKS</h3>
          <div className="grid grid-cols-5 gap-4 text-[10px] font-mono text-text-secondary">
            <div>
              <strong className="text-text-primary">Positioning (35%)</strong>
              <br />Funding rate, OI, liquidations, L/S ratio, options
            </div>
            <div>
              <strong className="text-text-primary">On-Chain (25%)</strong>
              <br />Exchange flow, stablecoin supply, whale transfers
            </div>
            <div>
              <strong className="text-text-primary">Sentiment (15%)</strong>
              <br />Fear & Greed, social signals
            </div>
            <div>
              <strong className="text-text-primary">Macro (15%)</strong>
              <br />DXY, yields, equity correlation
            </div>
            <div>
              <strong className="text-text-primary">Structure (10%)</strong>
              <br />Vol regime, order book depth
            </div>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
