"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { FearGreedGauge } from '@/components/features/FearGreedGauge'

interface MacroData {
  indicators: Array<{ name: string; value: number; change: number; source: string }>
  yieldCurve: { spread10Y2Y: number; signal: string }
  summary: { gdpGrowth: number; inflationRate: number; unemploymentRate: number; fedRate: number }
}

interface FearGreedData {
  composite: { score: number; label: string; previousScore: number; change: number }
  categories: Record<string, { score: number; weight: number; source: string }>
  regime: { state: string; stance: string }
  headerMetrics: { btcDom: number; totalMcap: number; mcapChange24h: number }
}

export default function MacroCommandCenter() {
  const [macro, setMacro] = useState<MacroData | null>(null)
  const [fg, setFg] = useState<FearGreedData | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const [macroRes, fgRes] = await Promise.allSettled([
        fetch('/api/v1/macro').then(r => r.json()),
        fetch('/api/v1/fear-greed').then(r => r.json()),
      ])
      if (macroRes.status === 'fulfilled' && macroRes.value?.data) setMacro(macroRes.value.data)
      if (fgRes.status === 'fulfilled' && fgRes.value?.data) setFg(fgRes.value.data)
      setStatus('live')
    } catch { setStatus('error') }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">🏛</span> Macro Command Center
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">Global macro indicators, yield curves, and crypto sentiment</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Left: Key Metrics */}
          <div className="col-span-4 space-y-4">
            <Panel title="Key Macro Indicators" subtitle="US & Global" liveStatus={status} onRefresh={fetchData}>
              <div className="space-y-3 p-2">
                {macro?.summary && (
                  <>
                    <MacroRow label="Fed Rate" value={`${macro.summary.fedRate.toFixed(2)}%`} />
                    <MacroRow label="US GDP Growth" value={`${macro.summary.gdpGrowth.toFixed(1)}%`} />
                    <MacroRow label="US Inflation" value={`${macro.summary.inflationRate.toFixed(1)}%`} />
                    <MacroRow label="US Unemployment" value={`${macro.summary.unemploymentRate.toFixed(1)}%`} />
                  </>
                )}
                {macro?.yieldCurve && (
                  <div className="border-t border-bg-border pt-2 mt-2">
                    <MacroRow label="Yield Spread (10Y-2Y)" value={`${macro.yieldCurve.spread10Y2Y.toFixed(2)}%`} />
                    <div className="text-[10px] font-mono mt-1">
                      Signal: <span className={`font-bold ${macro.yieldCurve.signal === 'Recession Risk' ? 'text-data-bear' : 'text-data-bull'}`}>{macro.yieldCurve.signal}</span>
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            {fg && <FearGreedGauge data={fg} />}
          </div>

          {/* Right: Detailed indicators */}
          <div className="col-span-8 space-y-4">
            <Panel title="World Bank / FRED Indicators" subtitle={`${macro?.indicators?.length ?? 0} tracked metrics`} liveStatus={status} onRefresh={fetchData}>
              <div className="grid grid-cols-2 gap-3 p-2">
                {(macro?.indicators ?? []).map((ind, i) => (
                  <div key={i} className="bg-bg-raised p-3 rounded border border-bg-border">
                    <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{ind.name}</div>
                    <div className="text-[20px] font-head font-bold text-text-primary tabular-nums">
                      {ind.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-[10px] font-mono font-bold ${ind.change >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                        {ind.change >= 0 ? '+' : ''}{ind.change.toFixed(2)}%
                      </span>
                      <span className="text-[9px] font-mono text-text-muted">{ind.source}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Market Regime */}
            {fg && (
              <Panel title="Market Regime Analysis" subtitle="AI-powered regime detection" liveStatus={status}>
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-4">
                    <div className="text-[48px] font-head font-bold" style={{ color: fg.composite.score > 50 ? '#36b37e' : '#ff5630' }}>
                      {fg.composite.score}
                    </div>
                    <div>
                      <div className="text-[14px] font-mono font-bold text-text-primary">{fg.regime.state}</div>
                      <div className="text-[11px] font-mono text-teal-vivid">Recommended: {fg.regime.stance}</div>
                      <div className="text-[10px] font-mono text-text-muted mt-1">
                        Market Cap: ${(fg.headerMetrics.totalMcap / 1e12).toFixed(2)}T ({fg.headerMetrics.mcapChange24h > 0 ? '+' : ''}{fg.headerMetrics.mcapChange24h.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-text-secondary leading-relaxed">
                    {fg.composite.score <= 30 && "Market is in extreme fear. Historically, this has been a good buying opportunity for long-term investors. Consider dollar-cost averaging into quality assets."}
                    {fg.composite.score > 30 && fg.composite.score <= 50 && "Market sentiment is bearish but stabilizing. Watch for reversal signals and maintain hedged positions. Avoid high-leverage trades."}
                    {fg.composite.score > 50 && fg.composite.score <= 70 && "Market is neutral with balanced sentiment. Good environment for swing trading and accumulating positions on dips."}
                    {fg.composite.score > 70 && "Market is showing greed. Be cautious with new positions and consider taking profits on existing holdings. Watch for distribution patterns."}
                  </div>
                </div>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}

function MacroRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-mono text-text-muted">{label}</span>
      <span className="text-[12px] font-mono font-bold text-text-primary tabular-nums">{value}</span>
    </div>
  )
}
