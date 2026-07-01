"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface PackageStats {
  name: string
  ecosystem: string
  category: string
  downloads: number
  previousDownloads: number | null
  changeMoM: number | null
}

interface EcosystemSummary {
  ecosystem: string
  totalDownloads: number
  previousDownloads: number | null
  changeMoM: number | null
  packageCount: number
  signal: string
}

interface DevActivity {
  packages: PackageStats[]
  ecosystemSummary: EcosystemSummary[]
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

function MoMBadge({ change }: { change: number | null }) {
  if (change === null) return <span className="text-[9px] text-text-dim font-mono">—</span>
  const positive = change >= 0
  const color = positive ? 'text-data-bull' : 'text-data-bear'
  return (
    <span className={`text-[10px] font-mono font-bold ${color}`}>
      {positive ? '+' : ''}{change.toFixed(1)}%
    </span>
  )
}

export default function DevActivityPage() {
  const [data, setData] = useState<DevActivity | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/dev-activity')
        const d = await res.json()
        if (d.data) setData(d.data)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
  }, [])

  const maxDl = data?.packages[0]?.downloads ?? 1

  // Sort ecosystems by MoM change (biggest gainers first)
  const sortedEcosystems = data?.ecosystemSummary
    ? [...data.ecosystemSummary].sort((a, b) => (b.changeMoM ?? 0) - (a.changeMoM ?? 0))
    : []

  // Sort packages by MoM change (biggest gainers first)
  const sortedPackages = data?.packages
    ? [...data.packages].sort((a, b) => (b.changeMoM ?? 0) - (a.changeMoM ?? 0))
    : []

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">DEV ACTIVITY</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              npm download trends for crypto packages — MoM tracking for ecosystem growth signals
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Ecosystem Summary with MoM */}
        {sortedEcosystems.length > 0 && (
          <Panel title="Ecosystem MoM Trends" subtitle="Month-over-month change — biggest gainers first">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
              {sortedEcosystems.map((eco) => (
                <div key={eco.ecosystem} className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-text-muted font-mono">{eco.ecosystem.toUpperCase()}</p>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      eco.signal === 'growing' ? 'bg-data-bull/20 text-data-bull' :
                      eco.signal === 'stable' ? 'bg-accent-amber/20 text-accent-amber' :
                      'bg-data-bear/20 text-data-bear'
                    }`}>{eco.signal}</span>
                  </div>
                  <p className="text-lg font-mono font-bold mt-1">{fmtNum(eco.totalDownloads)}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <MoMBadge change={eco.changeMoM} />
                    {eco.previousDownloads !== null && (
                      <span className="text-[9px] text-text-dim">vs {fmtNum(eco.previousDownloads)}</span>
                    )}
                  </div>
                  <p className="text-[9px] text-text-dim mt-1">{eco.packageCount} packages</p>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Package Rankings with MoM */}
        {sortedPackages.length > 0 && (
          <Panel title="Package MoM Trends" subtitle={`${sortedPackages.length} packages — sorted by MoM change`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 px-2 font-mono">#</th>
                    <th className="text-left py-2 px-2 font-mono">PACKAGE</th>
                    <th className="text-left py-2 px-2 font-mono">ECOSYSTEM</th>
                    <th className="text-right py-2 px-2 font-mono">DOWNLOADS</th>
                    <th className="text-right py-2 px-2 font-mono">PREV MONTH</th>
                    <th className="text-right py-2 px-2 font-mono">MoM</th>
                    <th className="text-left py-2 px-2 font-mono w-1/4">VOLUME</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPackages.map((pkg, i) => (
                    <tr key={pkg.name} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 px-2 text-text-dim">{i + 1}</td>
                      <td className="py-2 px-2 font-mono font-bold text-teal-vivid">{pkg.name}</td>
                      <td className="py-2 px-2">{pkg.ecosystem}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtNum(pkg.downloads)}</td>
                      <td className="py-2 px-2 text-right font-mono text-text-dim">
                        {pkg.previousDownloads !== null ? fmtNum(pkg.previousDownloads) : '—'}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <MoMBadge change={pkg.changeMoM} />
                      </td>
                      <td className="py-2 px-2">
                        <div className="h-2 bg-bg-raised rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent-cyan/60 rounded-full"
                            style={{ width: `${(pkg.downloads / maxDl) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Signals */}
        {sortedEcosystems.length > 0 && (
          <Panel title="Actionable Signals" subtitle="What the MoM data tells us">
            <div className="p-4 space-y-3">
              {sortedEcosystems.filter(e => e.changeMoM !== null && Math.abs(e.changeMoM) > 10).map(eco => (
                <div key={eco.ecosystem} className="flex items-center gap-3">
                  <span className={`text-[10px] font-mono px-2 py-1 rounded ${
                    eco.changeMoM! > 0 ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                  }`}>
                    {eco.changeMoM! > 0 ? 'BULLISH' : 'BEARISH'}
                  </span>
                  <p className="text-xs text-text-primary">
                    <strong>{eco.ecosystem}</strong> dev activity{' '}
                    <span className={eco.changeMoM! > 0 ? 'text-data-bull' : 'text-data-bear'}>
                      {eco.changeMoM! > 0 ? 'up' : 'down'} {Math.abs(eco.changeMoM!).toFixed(1)}% MoM
                    </span>
                    {' '}— {eco.changeMoM! > 10 ? 'developers building, ecosystem growing' : 'developers leaving, ecosystem cooling'}
                  </p>
                </div>
              ))}
              {sortedEcosystems.filter(e => e.changeMoM !== null && Math.abs(e.changeMoM) > 10).length === 0 && (
                <p className="text-xs text-text-dim">No significant MoM changes yet. Data accumulates over time.</p>
              )}
            </div>
          </Panel>
        )}

        {/* Methodology */}
        <Panel title="Methodology" subtitle="How dev activity is measured">
          <div className="p-4 text-xs text-text-dim space-y-2">
            <p><strong className="text-text-primary">Data source:</strong> npm registry public API (api.npmjs.org) — monthly download counts.</p>
            <p><strong className="text-text-primary">MoM tracking:</strong> Each fetch persists a snapshot. Previous snapshot is used for month-over-month comparison.</p>
            <p><strong className="text-text-primary">Signal threshold:</strong> {'>'}10% MoM change = growing/declining. Within 10% = stable.</p>
            <p><strong className="text-text-primary">Leading indicator:</strong> Developers build before users arrive. Rising dev activity today = more dApps in 3-6 months.</p>
            <p><strong className="text-text-primary">Limitations:</strong> npm downloads include CI/CD bots. Trend over time is more meaningful than absolute numbers.</p>
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
