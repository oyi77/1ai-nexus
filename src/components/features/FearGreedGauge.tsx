"use client"

import { useEffect, useState } from 'react'

interface FearGreedData {
  composite: { score: number; label: string; previousScore: number; change: number }
  categories: Record<string, { score: number; weight: number; source: string }>
  regime: { state: string; stance: string }
  headerMetrics: { btcDom: number; totalMcap: number; mcapChange24h: number }
}

function getColor(score: number): string {
  if (score <= 20) return '#ff5630'
  if (score <= 40) return '#ff8b00'
  if (score <= 60) return '#ffc400'
  if (score <= 80) return '#36b37e'
  return '#00b8d9'
}

function getLabel(score: number): string {
  if (score <= 20) return 'Extreme Fear'
  if (score <= 40) return 'Fear'
  if (score <= 60) return 'Neutral'
  if (score <= 80) return 'Greed'
  return 'Extreme Greed'
}

export function FearGreedGauge({ data }: { data: FearGreedData }) {
  const score = data.composite.score
  const color = getColor(score)
  const angle = -90 + (score / 100) * 180

  return (
    <div className="flex flex-col items-center p-4 bg-bg-panel border border-bg-border rounded">
      <h3 className="text-[11px] font-mono text-text-muted uppercase mb-2">Fear & Greed Index</h3>
      
      {/* Gauge */}
      <div className="relative w-48 h-24 mb-2">
        <svg viewBox="0 0 200 100" className="w-full h-full">
          {/* Background arc */}
          <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="#333" strokeWidth="12" strokeLinecap="round" />
          {/* Colored segments */}
          <path d="M 20 90 A 80 80 0 0 1 56 26" fill="none" stroke="#ff5630" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
          <path d="M 56 26 A 80 80 0 0 1 100 10" fill="none" stroke="#ff8b00" strokeWidth="12" opacity="0.3" />
          <path d="M 100 10 A 80 80 0 0 1 144 26" fill="none" stroke="#ffc400" strokeWidth="12" opacity="0.3" />
          <path d="M 144 26 A 80 80 0 0 1 180 90" fill="none" stroke="#36b37e" strokeWidth="12" opacity="0.3" />
          {/* Needle */}
          <line
            x1="100" y1="90"
            x2={100 + 60 * Math.cos((angle * Math.PI) / 180)}
            y2={90 + 60 * Math.sin((angle * Math.PI) / 180)}
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="100" cy="90" r="6" fill={color} />
        </svg>
      </div>

      <div className="text-center">
        <div className="text-[32px] font-head font-bold tabular-nums" style={{ color }}>{score}</div>
        <div className="text-[12px] font-mono font-bold" style={{ color }}>{getLabel(score)}</div>
        <div className="text-[10px] font-mono text-text-muted mt-1">
          {data.composite.change > 0 ? '+' : ''}{data.composite.change} from yesterday
        </div>
      </div>

      {/* Regime */}
      <div className="mt-3 flex items-center gap-2 bg-bg-raised px-3 py-1 rounded text-[10px] font-mono">
        <span className="text-text-muted">Regime:</span>
        <span className="text-text-primary font-bold">{data.regime.state}</span>
        <span className="text-teal-vivid font-bold">→ {data.regime.stance}</span>
      </div>

      {/* Category Breakdown */}
      <div className="mt-3 w-full space-y-1">
        {Object.entries(data.categories).map(([key, cat]) => (
          <div key={key} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-text-muted w-16 capitalize">{key}</span>
            <div className="flex-1 h-1.5 bg-bg-raised rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${cat.score}%`, backgroundColor: getColor(cat.score) }} />
            </div>
            <span className="text-text-primary w-6 text-right tabular-nums">{cat.score}</span>
          </div>
        ))}
      </div>

      {/* Market Cap & BTC Dom */}
      <div className="mt-3 flex items-center gap-4 text-[10px] font-mono text-text-muted">
        <span>BTC Dom: <span className="text-text-primary font-bold">{data.headerMetrics.btcDom.toFixed(1)}%</span></span>
        <span>MCap: <span className="text-text-primary font-bold">${(data.headerMetrics.totalMcap / 1e12).toFixed(2)}T</span></span>
      </div>
    </div>
  )
}
