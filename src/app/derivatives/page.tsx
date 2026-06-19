"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"

export default function DerivativesPage() {
  const [, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/v1/modules/fetch?module=derivatives-aggregate&action=open-interest&symbol=BTCUSDT').then(r => r.json()),
      fetch('/api/v1/modules/fetch?module=derivatives-aggregate&action=funding&symbol=BTCUSDT').then(r => r.json()),
      fetch('/api/v1/modules/fetch?module=hyperliquid&action=leaderboard').then(r => r.json()),
    ]).then(([oi, funding, lb]) => {
      setData({
        openInterest: oi.status === 'fulfilled' ? oi.value?.data : null,
        funding: funding.status === 'fulfilled' ? funding.value?.data : null,
        leaderboard: lb.status === 'fulfilled' ? lb.value?.data : null,
      })
      setLoading(false)
    })
  }, [])

  return (
    <TerminalShell>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-bold font-mono text-accent-cyan">DERIVATIVES DASHBOARD</h1>

        {loading ? (
          <div className="text-text-dim text-xs">Loading derivatives data...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Aggregated OI */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h2 className="text-xs font-mono text-accent-cyan mb-3">AGGREGATED OPEN INTEREST — BTC</h2>
              <div className="text-text-dim text-xs">
                <p>Data from Binance + Bybit aggregated via derived module</p>
              </div>
            </div>

            {/* Funding Rates */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h2 className="text-xs font-mono text-accent-cyan mb-3">FUNDING RATES — BTC</h2>
              <div className="text-text-dim text-xs">
                <p>Multi-exchange funding rate comparison</p>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4 lg:col-span-2">
              <h2 className="text-xs font-mono text-accent-cyan mb-3">TRADER LEADERBOARD — HYPERLIQUID</h2>
              <div className="text-text-dim text-xs">
                <p>Top traders by 30d PnL from Hyperliquid public leaderboard</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </TerminalShell>
  )
}
