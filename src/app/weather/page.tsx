"use client"

import { useMemo, useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

// ─── Types ─────────────────────────────────────────────────

interface WeatherAnomaly {
  metric: string
  currentValue: number
  historicalMean: number
  historicalStdDev: number
  zScore: number
  isAnomaly: boolean
}

interface AnomalyRegion {
  region: string
  anomalies: WeatherAnomaly[]
  affectedCommodities: Array<{ commodity: string; tickers: string[] }>
}

interface WeatherAnomaliesResponse {
  action: string
  scannedRegions: number
  anomalyRegions: number
  results: AnomalyRegion[]
}

interface FlatAnomaly {
  region: string
  metric: string
  currentValue: number
  historicalMean: number
  zScore: number
  commodities: string
  tickers: string
  absZ: number
}

// ─── Region display names ──────────────────────────────────

const REGION_LABELS: Record<string, string> = {
  sumatra: 'Sumatra',
  texas: 'Texas',
  'black-sea': 'Black Sea',
  midwest: 'US Midwest',
  india: 'India',
}

// ─── Commodity icons / colors ──────────────────────────────

const COMMODITY_COLORS: Record<string, string> = {
  'Palm Oil':       'bg-amber-500/20 text-amber-400',
  'Coffee':         'bg-rose-500/20 text-rose-400',
  'Rubber':         'bg-emerald-500/20 text-emerald-400',
  'Wheat':          'bg-yellow-500/20 text-yellow-400',
  'Cotton':         'bg-sky-500/20 text-sky-400',
  'Sugar':          'bg-pink-500/20 text-pink-400',
  'Natural Gas':    'bg-violet-500/20 text-violet-400',
  'Cattle':         'bg-orange-500/20 text-orange-400',
  'Corn':           'bg-lime-500/20 text-lime-400',
  'Soybeans':       'bg-teal-500/20 text-teal-400',
  'Rice':           'bg-indigo-500/20 text-indigo-400',
  'Cocoa':          'bg-stone-500/20 text-stone-400',
}

function commodityColor(name: string): string {
  return COMMODITY_COLORS[name] || 'bg-bg-raised text-text-muted'
}

// ─── Z-Score helpers ───────────────────────────────────────

function zScoreColor(z: number): string {
  const absZ = Math.abs(z)
  if (absZ >= 3) return 'text-red-400'
  if (absZ >= 2.5) return 'text-orange-400'
  if (absZ >= 2) return 'text-amber-400'
  if (absZ >= 1.5) return 'text-yellow-300'
  return 'text-text-secondary'
}

function zScoreBg(z: number): string {
  const absZ = Math.abs(z)
  if (absZ >= 3) return 'bg-red-500/20'
  if (absZ >= 2.5) return 'bg-orange-500/15'
  if (absZ >= 2) return 'bg-amber-500/15'
  return 'bg-bg-raised'
}

function zScoreBar(z: number): string {
  const absZ = Math.abs(z)
  if (absZ >= 3) return 'bg-red-500'
  if (absZ >= 2.5) return 'bg-orange-500'
  if (absZ >= 2) return 'bg-amber-500'
  return 'bg-teal-vivid'
}

// ─── Component ─────────────────────────────────────────────

export default function WeatherPage() {
  const { data, status, refresh } = useLiveFetch<WeatherAnomaliesResponse>({
    url: '/api/v1/weather-signals?action=anomalies',
    interval: 5 * 60 * 1000,
    initialData: {
      action: 'anomalies',
      scannedRegions: 0,
      anomalyRegions: 0,
      results: [],
    },
  })

  const [regionFilter, setRegionFilter] = useState('all')

  const results = data?.results || []
  const allCommodities = useMemo(() => {
    const set = new Set<string>()
    for (const r of results) {
      for (const c of r.affectedCommodities) set.add(c.commodity)
    }
    return Array.from(set).sort()
  }, [results])

  // Flatten anomalies for the table
  const flatRows: FlatAnomaly[] = useMemo(() => {
    const rows: FlatAnomaly[] = []
    for (const r of results) {
      if (regionFilter !== 'all' && r.region !== regionFilter) continue
      for (const a of r.anomalies) {
        const commNames = [...new Set(r.affectedCommodities.map((c) => c.commodity))]
        const allTickers = [...new Set(r.affectedCommodities.flatMap((c) => c.tickers))]
        rows.push({
          region: r.region,
          metric: a.metric,
          currentValue: a.currentValue,
          historicalMean: a.historicalMean,
          zScore: a.zScore,
          commodities: commNames.join(', '),
          tickers: allTickers.join(', '),
          absZ: Math.abs(a.zScore),
        })
      }
    }
    return rows.sort((a, b) => b.absZ - a.absZ)
  }, [results, regionFilter])

  const regionKeys = useMemo(
    () => [...new Set(results.map((r) => r.region))],
    [results],
  )

  const totalAnomalies = flatRows.length
  const criticalCount = flatRows.filter((r) => r.absZ >= 3).length

  // ─── Table columns ────────────────────────────────────────

  const columns: Column<FlatAnomaly>[] = [
    {
      key: 'region',
      header: 'Region',
      width: 110,
      render: (r) => (
        <span className="text-teal-vivid font-bold text-[11px]">
          {REGION_LABELS[r.region] || r.region}
        </span>
      ),
    },
    {
      key: 'metric',
      header: 'Metric',
      width: 140,
      render: (r) => {
        const label = r.metric === 'temperature_2m_max'
          ? 'Temp (max)'
          : r.metric === 'precipitation_sum'
            ? 'Precipitation'
            : r.metric.replace(/_/g, ' ')
        return <span className="text-text-primary text-[11px] capitalize">{label}</span>
      },
    },
    {
      key: 'zScore',
      header: 'Z-Score',
      width: 160,
      sortable: true,
      accessor: (r) => r.absZ,
      render: (r) => {
        const pct = Math.min(100, (r.absZ / 4) * 100)
        return (
          <div className="flex items-center gap-2">
            <span className={`font-mono font-bold text-[11px] tabular-nums w-10 ${zScoreColor(r.zScore)}`}>
              {r.zScore > 0 ? '+' : ''}{r.zScore.toFixed(2)}
            </span>
            <div className="flex-1 h-1.5 bg-bg-raised rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${zScoreBar(r.zScore)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      },
    },
    {
      key: 'currentValue',
      header: 'Current',
      width: 80,
      align: 'right',
      render: (r) => (
        <span className="text-text-primary font-mono text-[10px] tabular-nums">
          {r.currentValue.toFixed(1)}
        </span>
      ),
    },
    {
      key: 'historicalMean',
      header: 'Mean',
      width: 80,
      align: 'right',
      render: (r) => (
        <span className="text-text-muted font-mono text-[10px] tabular-nums">
          {r.historicalMean.toFixed(1)}
        </span>
      ),
    },
    {
      key: 'commodities',
      header: 'Affected Commodities',
      width: 200,
      render: (r) => {
        const items = r.commodities.split(', ')
        return (
          <div className="flex flex-wrap gap-1">
            {items.map((c) => (
              <span
                key={c}
                className={`px-1.5 py-0.5 rounded text-[8px] font-mono ${commodityColor(c)}`}
              >
                {c}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      key: 'tickers',
      header: 'Affected Tickers',
      width: 160,
      render: (r) => {
        const items = r.tickers.split(', ')
        return (
          <div className="flex flex-wrap gap-1">
            {items.slice(0, 4).map((t) => (
              <span
                key={t}
                className="px-1 py-0.5 rounded bg-bg-raised text-[9px] font-mono text-teal-vivid"
              >
                {t}
              </span>
            ))}
            {items.length > 4 && (
              <span className="text-[9px] font-mono text-text-muted">
                +{items.length - 4}
              </span>
            )}
          </div>
        )
      },
    },
  ]

  // ─── Render ─────────────────────────────────────────────

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">
              Weather Signals
            </h1>
            <p className="text-[11px] text-text-muted font-mono">
              Open-Meteo anomaly detection — z-score vs 30-day historical baseline
            </p>
          </div>
          <div className="flex items-center gap-3">
            {criticalCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-mono animate-pulse">
                {criticalCount} CRITICAL
              </span>
            )}
            <LiveDot status={status} label />
          </div>
        </div>

        {/* Commodity Map — overview of affected regions & commodities */}
        <Panel
          title="Commodity Exposure Map"
          subtitle={`${data?.scannedRegions ?? 0} regions scanned · ${data?.anomalyRegions ?? 0} with anomalies`}
          liveStatus={status}
          onRefresh={refresh}
        >
          <div className="p-3">
            {results.length === 0 ? (
              <div className="text-center text-[11px] text-text-muted py-4">
                {status === 'error'
                  ? 'Failed to load data — check network'
                  : 'Scanning regions for anomalies...'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {results.map((r) => {
                  const maxZ = Math.max(...r.anomalies.map((a) => Math.abs(a.zScore)))
                  const severity =
                    maxZ >= 3 ? 'critical' : maxZ >= 2.5 ? 'high' : maxZ >= 2 ? 'elevated' : 'moderate'
                  const borderMap = {
                    critical: 'border-red-500/50',
                    high: 'border-orange-500/40',
                    elevated: 'border-amber-500/30',
                    moderate: 'border-bg-border',
                  }

                  return (
                    <div
                      key={r.region}
                      className={`rounded-lg border ${borderMap[severity]} bg-bg-base/50 p-3 space-y-2`}
                    >
                      {/* Region header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${zScoreBar(r.anomalies[0]?.zScore ?? 0)}`} />
                          <span className="text-[12px] font-head font-bold text-text-primary">
                            {REGION_LABELS[r.region] || r.region}
                          </span>
                        </div>
                        <span className={`text-[10px] font-mono uppercase tracking-wider ${
                          severity === 'critical' ? 'text-red-400' :
                          severity === 'high' ? 'text-orange-400' :
                          severity === 'elevated' ? 'text-amber-400' : 'text-text-muted'
                        }`}>
                          {severity}
                        </span>
                      </div>

                      {/* Anomaly pills */}
                      <div className="flex flex-wrap gap-1.5">
                        {r.anomalies.map((a) => {
                          const label = a.metric === 'temperature_2m_max'
                            ? 'Temp'
                            : a.metric === 'precipitation_sum'
                              ? 'Precip'
                              : a.metric
                          return (
                            <div
                              key={a.metric}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded ${zScoreBg(a.zScore)}`}
                            >
                              <span className="text-[9px] font-mono text-text-muted uppercase">
                                {label}
                              </span>
                              <span className={`text-[10px] font-mono font-bold tabular-nums ${zScoreColor(a.zScore)}`}>
                                {a.zScore > 0 ? '+' : ''}{a.zScore.toFixed(1)}σ
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Affected commodities */}
                      <div className="flex flex-wrap gap-1">
                        {r.affectedCommodities.map((c) => (
                          <span
                            key={c.commodity}
                            className={`px-1.5 py-0.5 rounded text-[8px] font-mono ${commodityColor(c.commodity)}`}
                          >
                            {c.commodity}
                          </span>
                        ))}
                      </div>

                      {/* Tickers */}
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(r.affectedCommodities.flatMap((c) => c.tickers))].map(
                          (t) => (
                            <span
                              key={t}
                              className="px-1 py-0.5 rounded bg-bg-raised text-[9px] font-mono text-teal-vivid"
                            >
                              {t}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Panel>

        {/* Region filters */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <button
              onClick={() => setRegionFilter('all')}
              className={`px-2 py-1 rounded ${
                regionFilter === 'all'
                  ? 'bg-teal-dim/30 text-teal-vivid'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              ALL
            </button>
            {regionKeys.map((k) => (
              <button
                key={k}
                onClick={() => setRegionFilter(k)}
                className={`px-2 py-1 rounded capitalize ${
                  regionFilter === k
                    ? 'bg-teal-dim/30 text-teal-vivid'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {REGION_LABELS[k] || k}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px] text-text-muted font-mono">
            {totalAnomalies} anomal{totalAnomalies === 1 ? 'y' : 'ies'}
          </span>
        </div>

        {/* Anomalies Table */}
        <Panel
          title="Weather Anomalies"
          subtitle="Ranked by |z-score| descending"
          liveStatus={status}
          onRefresh={refresh}
          maxHeight={600}
        >
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={flatRows as unknown as Record<string, unknown>[]}
            sortable
            rowHeight={36}
            emptyState={
              <div className="text-text-muted text-[11px] p-4 text-center">
                {status === 'error'
                  ? 'Failed to load data — check network'
                  : 'No anomalies detected across scanned regions'}
              </div>
            }
          />
        </Panel>
      </div>
    </NexusLayout>
  )
}
