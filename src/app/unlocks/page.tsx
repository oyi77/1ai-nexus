"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface UnlockEvent {
  token: string
  symbol: string
  unlockDate: string
  amountUsd: number | null
  percentOfSupply: number | null
  source: string
}

function fmtUsd(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function daysUntil(date: string): number {
  const diff = new Date(date).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

function urgencyColor(days: number): string {
  if (days <= 7) return 'text-data-bear'
  if (days <= 30) return 'text-accent-amber'
  return 'text-text-muted'
}

export default function UnlocksPage() {
  const [unlocks, setUnlocks] = useState<UnlockEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/unlocks')
      .then(r => r.json())
      .then(d => {
        setUnlocks(d.data?.unlocks ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const totalSupplyShock = unlocks.reduce((s, u) => s + (u.amountUsd ?? 0), 0)
  const nextUnlock = unlocks[0]

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">TOKEN UNLOCK CALENDAR</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Upcoming supply events — known unlock schedules from public data
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
            <p className="text-[10px] text-text-muted font-mono">UPCOMING UNLOCKS</p>
            <p className="text-lg font-mono font-bold">{unlocks.length}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
            <p className="text-[10px] text-text-muted font-mono">TOTAL SUPPLY SHOCK</p>
            <p className="text-lg font-mono font-bold text-accent-amber">{fmtUsd(totalSupplyShock)}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
            <p className="text-[10px] text-text-muted font-mono">NEXT UNLOCK</p>
            <p className="text-sm font-mono font-bold">{nextUnlock ? `${nextUnlock.symbol} in ${daysUntil(nextUnlock.unlockDate)}d` : '—'}</p>
          </div>
        </div>

        {/* Unlock List */}
        <Panel title="Upcoming Unlocks" subtitle={`${unlocks.length} scheduled events`}>
          {loading ? (
            <div className="text-text-dim text-xs p-4 text-center">Loading unlock schedule...</div>
          ) : unlocks.length === 0 ? (
            <div className="text-text-dim text-xs p-4 text-center">No upcoming unlocks found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 px-2 font-mono">TOKEN</th>
                    <th className="text-left py-2 px-2 font-mono">DATE</th>
                    <th className="text-right py-2 px-2 font-mono">DAYS</th>
                    <th className="text-right py-2 px-2 font-mono">AMOUNT</th>
                    <th className="text-right py-2 px-2 font-mono">% SUPPLY</th>
                    <th className="text-left py-2 px-2 font-mono">SOURCE</th>
                  </tr>
                </thead>
                <tbody>
                  {unlocks.map((u, i) => {
                    const days = daysUntil(u.unlockDate)
                    return (
                      <tr key={i} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 px-2 font-mono font-bold text-teal-vivid">{u.symbol}</td>
                        <td className="py-2 px-2 font-mono">{u.unlockDate}</td>
                        <td className={`py-2 px-2 text-right font-mono font-bold ${urgencyColor(days)}`}>{days}d</td>
                        <td className="py-2 px-2 text-right font-mono">{fmtUsd(u.amountUsd)}</td>
                        <td className="py-2 px-2 text-right font-mono">{u.percentOfSupply?.toFixed(1) ?? '—'}%</td>
                        <td className="py-2 px-2 text-text-muted">{u.source}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <p className="text-[9px] text-text-dim font-mono">
            Source: Public token vesting schedules, community-maintained data. Unlock dates are approximate.
            Large unlocks often create sell pressure — monitor for distribution patterns in smart money flows.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
