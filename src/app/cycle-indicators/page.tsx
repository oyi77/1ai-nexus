"use client"

import { useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'
import { Activity } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────

interface CycleIndicatorData {
  name: string
  value: number
  zone: string
  description: string
  raw: {
    marketCap?: number
    realizedCapProxy?: number
    btcMarketCap?: number
    stablecoinMarketCap?: number
    stdDev?: number
  }
}

interface CycleIndicatorsResponse {
  indicators: {
    mvrv: CycleIndicatorData
    nupl: CycleIndicatorData
    ssr: CycleIndicatorData
    dominance: CycleIndicatorData
  }
  timestamp: string
  source: string
}

interface HistoryPoint {
  id: string
  indicator: string
  value: number
  zone: string
  timestamp: string
}

// ── Zone helpers ──────────────────────────────────────────

function zoneColor(zone: string): string {
  switch (zone) {
    case 'euphoria':   return '#ff5630'
    case 'bull':       return '#36b37e'
    case 'hope':       return '#6554c0'
    case 'neutral':    return '#ffc400'
    case 'accumulation': return '#00b8d9'
    case 'capitulation': return '#ff5630'
    default:           return '#6b778c'
  }
}

function zoneLabel(zone: string): string {
  switch (zone) {
    case 'euphoria':     return 'Euphoria'
    case 'bull':         return 'Bull'
    case 'hope':         return 'Hope / Fear'
    case 'neutral':      return 'Neutral'
    case 'accumulation': return 'Accumulation'
    case 'capitulation': return 'Capitulation'
    default:             return zone
  }
}

function zoneBg(zone: string): string {
  switch (zone) {
    case 'euphoria':     return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'bull':         return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    case 'hope':         return 'bg-violet-500/15 text-violet-400 border-violet-500/30'
    case 'neutral':      return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    case 'accumulation': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
    case 'capitulation': return 'bg-red-500/15 text-red-400 border-red-500/30'
    default:             return 'bg-bg-raised text-text-muted border-bg-border'
  }
}

// ── Gauge SVG ─────────────────────────────────────────────

function GaugeCircle({
  value,
  max,
  label,
  zone,
  unit,
  size = 120,
}: {
  value: number
  max: number
  label: string
  zone: string
  unit?: string
  size?: number
}) {
  const color = zoneColor(zone)
  const pct = Math.min(Math.max(Math.abs(value) / max, 0), 1)
  const radius = (size - 16) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct)
  const cx = size / 2
  const cy = size / 2

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="rotate-[-90deg]">
        {/* Background track */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="var(--color-bg-raised, #1a1a2e)"
          strokeWidth={8}
        />
        {/* Value arc */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        {/* Center text */}
        <text
          x={cx} y={cy - 4}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={size * 0.2}
          fontWeight="bold"
          fontFamily="monospace"
          className="rotate-[90deg] origin-center"
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          {value.toFixed(2)}
        </text>
        <text
          x={cx} y={cy + size * 0.14}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-text-muted, #6b778c)"
          fontSize={size * 0.1}
          fontFamily="monospace"
          className="rotate-[90deg] origin-center"
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          {unit ?? ''}
        </text>
      </svg>
      <span className="text-[11px] font-mono text-text-muted">{label}</span>
    </div>
  )
}

// ── Mini sparkline for history ────────────────────────────

function Sparkline({
  data,
  width = 200,
  height = 40,
  color,
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (data.length < 2) return <div className="text-[10px] text-text-muted">No history yet</div>

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 4

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - 2 * pad)
    const y = height - pad - ((v - min) / range) * (height - 2 * pad)
    return `${x},${y}`
  })

  const lineColor = color || (data[data.length - 1] >= data[0] ? '#36b37e' : '#ff5630')

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── Indicator card ────────────────────────────────────────

function IndicatorCard({
  ind,
  history,
}: {
  ind: CycleIndicatorData
  history: HistoryPoint[]
}) {
  const historyValues = history.map(h => h.value)
  const maxGauge = ind.name === 'MVRV Z-Score' ? 10 : ind.name === 'NUPL' ? 1 : ind.name === 'SSR' ? 15 : 20
  const unit = ind.name === 'Stablecoin Dominance' ? '%' : undefined

  return (
    <Panel title={ind.name} subtitle={ind.description}>
      <div className="p-4 flex flex-col items-center gap-3">
        <GaugeCircle
          value={ind.value}
          max={maxGauge}
          label={ind.name}
          zone={ind.zone}
          unit={unit}
          size={140}
        />
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded border text-[11px] font-mono font-bold ${zoneBg(ind.zone)}`}>
          {zoneLabel(ind.zone)}
        </span>
        {historyValues.length > 0 && (
          <div className="w-full mt-1">
            <Sparkline data={historyValues} width={220} height={32} color={zoneColor(ind.zone)} />
          </div>
        )}
      </div>
    </Panel>
  )
}

// ── Page ──────────────────────────────────────────────────

export function CycleIndicatorsPageContent() {
  return <CycleIndicatorsPageInner />
}

export default function CycleIndicatorsPage() {
  return <NexusLayout><CycleIndicatorsPageInner /></NexusLayout>
}

function CycleIndicatorsPageInner() {
  const { data, status, refresh } = useLiveFetch<CycleIndicatorsResponse>({
    url: '/api/v1/cycle-indicators?action=current',
    interval: 300_000, // 5 min
  })

  const { data: mvrvHistory } = useLiveFetch<HistoryPoint[]>({
    url: '/api/v1/cycle-indicators?action=history&indicator=mvrv&limit=50',
    interval: 60_000,
    initialData: [],
  })

  const { data: nuplHistory } = useLiveFetch<HistoryPoint[]>({
    url: '/api/v1/cycle-indicators?action=history&indicator=nupl&limit=50',
    interval: 60_000,
    initialData: [],
  })

  const { data: ssrHistory } = useLiveFetch<HistoryPoint[]>({
    url: '/api/v1/cycle-indicators?action=history&indicator=ssr&limit=50',
    interval: 60_000,
    initialData: [],
  })

  const { data: domHistory } = useLiveFetch<HistoryPoint[]>({
    url: '/api/v1/cycle-indicators?action=history&indicator=dominance&limit=50',
    interval: 60_000,
    initialData: [],
  })

  const indicators = data?.indicators

  // Summary stats
  const summaryStats = useMemo(() => {
    if (!indicators) return []
    return [
      {
        label: 'Total Market Cap',
        value: indicators.mvrv.raw.marketCap
          ? `$${(indicators.mvrv.raw.marketCap / 1e12).toFixed(2)}T`
          : '—',
        color: 'text-text-primary',
      },
      {
        label: 'BTC Market Cap',
        value: indicators.ssr.raw.btcMarketCap
          ? `$${(indicators.ssr.raw.btcMarketCap / 1e12).toFixed(2)}T`
          : '—',
        color: 'text-data-bull',
      },
      {
        label: 'Stablecoin Supply',
        value: indicators.ssr.raw.stablecoinMarketCap
          ? `$${(indicators.ssr.raw.stablecoinMarketCap / 1e9).toFixed(1)}B`
          : '—',
        color: 'text-teal-vivid',
      },
      {
        label: 'Realized Cap (proxy)',
        value: indicators.mvrv.raw.realizedCapProxy
          ? `$${(indicators.mvrv.raw.realizedCapProxy / 1e12).toFixed(2)}T`
          : '—',
        color: 'text-text-primary',
      },
    ]
  }, [indicators])

  return (
    <>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-teal-vivid" />
            <div>
              <h1 className="text-[20px] font-head font-bold text-text-primary">Cycle Indicators</h1>
              <p className="text-[11px] text-text-muted font-mono">
                MVRV, NUPL, SSR — on-chain cycle position from CoinGecko data
              </p>
            </div>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
          {summaryStats.map((s, i) => (
            <div key={i} className="bg-bg-panel border border-bg-border px-3 py-2">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-1">{s.label}</div>
              <div className={`text-[15px] font-head font-bold tabular-nums ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Gauge grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {indicators && (
            <>
              <IndicatorCard ind={indicators.mvrv} history={mvrvHistory ?? []} />
              <IndicatorCard ind={indicators.nupl} history={nuplHistory ?? []} />
              <IndicatorCard ind={indicators.ssr} history={ssrHistory ?? []} />
              <IndicatorCard ind={indicators.dominance} history={domHistory ?? []} />
            </>
          )}
          {!indicators && (
            <div className="col-span-4 p-8 text-center text-text-muted text-[13px] font-mono">
              Loading cycle indicators…
            </div>
          )}
        </div>

        {/* Methodology */}
        <Panel title="Methodology" subtitle="How these indicators work">
          <div className="p-3 space-y-3 text-[11px] text-text-secondary">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-teal-vivid font-bold">MVRV Z-Score</span>
                  <span className="text-[9px] font-mono text-text-muted">(Market Value to Realized Value)</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  Measures how far market cap deviates from realized cap in standard deviations.
                  Computed as: <span className="font-mono text-teal-vivid">(Market Cap − Realized Cap Proxy) / StdDev</span>.
                  Uses FDV as a proxy for realized cap. &gt;7 = extreme overvaluation, &lt;−0.5 = capitulation.
                  Academic research: Puell Multiple, Woo&apos;s Law.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-teal-vivid font-bold">NUPL</span>
                  <span className="text-[9px] font-mono text-text-muted">(Net Unrealized Profit/Loss)</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  Ratio of unrealized profit to total market cap.
                  Computed as: <span className="font-mono text-teal-vivid">1 − (Realized Cap / Market Cap)</span>.
                  &gt;0.75 = euphoria (most holders in profit), &lt;0 = capitulation (aggregate loss).
                  Source: Adaptive Capital / LookIntoBitcoin.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-teal-vivid font-bold">SSR</span>
                  <span className="text-[9px] font-mono text-text-muted">(Stablecoin Supply Ratio)</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  Ratio of BTC market cap to total stablecoin market cap.
                  Low SSR = stablecoins have high purchasing power relative to BTC — potential buying pressure.
                  High SSR = stablecoins are relatively scarce, less sidelined capital.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-teal-vivid font-bold">Stablecoin Dominance</span>
                  <span className="text-[9px] font-mono text-text-muted">(% of total market)</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  Stablecoin market cap as a percentage of total crypto market cap.
                  Rising dominance = capital flowing to safety (risk-off).
                  Falling dominance = capital rotating into risk assets (risk-on).
                </p>
              </div>
            </div>

            <div className="border-t border-bg-border pt-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-teal-vivid font-bold">Zone Legend</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { zone: 'euphoria', label: 'Euphoria', color: 'text-red-400' },
                  { zone: 'bull', label: 'Bull', color: 'text-emerald-400' },
                  { zone: 'hope', label: 'Hope / Fear', color: 'text-violet-400' },
                  { zone: 'neutral', label: 'Neutral', color: 'text-yellow-400' },
                  { zone: 'accumulation', label: 'Accumulation', color: 'text-cyan-400' },
                  { zone: 'capitulation', label: 'Capitulation', color: 'text-red-400' },
                ].map(z => (
                  <span key={z.zone} className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono ${zoneBg(z.zone)}`}>
                    {z.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="border-t border-bg-border pt-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-teal-vivid font-bold">Data Source</span>
              </div>
              <p className="text-[10px] leading-relaxed">
                CoinGecko free API — <span className="font-mono">/api/v3/global</span> for total market cap,
                <span className="font-mono"> /coins/bitcoin</span> for BTC market cap + FDV,
                <span className="font-mono"> /global/decentralized_finance_defi</span> for stablecoin supply.
                Realized cap uses FDV as a proxy (simplification). Refreshes every 5 minutes.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}
