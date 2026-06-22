"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { AlertPill } from '@/components/primitives/AlertPill'
import { LiveDot } from '@/components/primitives/LiveDot'
import { PriceTag } from '@/components/primitives/PriceTag'
import { TxHash } from '@/components/primitives/TxHash'

interface AlertRule {
  id: string
  name: string
  type: string
  condition: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  enabled: boolean
  lastTriggered: string
  fireCount: number
}

interface TriggeredAlert {
  id: string
  ruleId: string
  ruleName: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  message: string
  value: number
  txHash?: string
  timestamp: string
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [triggered, setTriggered] = useState<TriggeredAlert[]>([])
  const [feedStatus, setFeedStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [showCreate, setShowCreate] = useState(false)

  const fetchAlerts = useCallback(async () => {
    try {
      // Fetch real alerts from API
      const res = await fetch('/api/v1/alerts')
      const _data = await res.json()

      // Generate sample rules
      setRules([
        { id: '1', name: 'Whale Wallet Monitor', type: 'wallet_moved', condition: '0x28C6... transfers > $500K', severity: 'high', enabled: true, lastTriggered: '2h ago', fireCount: 14 },
        { id: '2', name: 'BTC Price Alert', type: 'price_threshold', condition: 'BTC > $70,000 or < $60,000', severity: 'medium', enabled: true, lastTriggered: '6h ago', fireCount: 3 },
        { id: '3', name: 'Large DEX Swap', type: 'large_swap', condition: 'Any swap > $1M on Uniswap', severity: 'critical', enabled: true, lastTriggered: '45m ago', fireCount: 8 },
        { id: '4', name: 'Smart Money Signal', type: 'smart_money', condition: 'Top 10 wallets accumulate > $100K', severity: 'high', enabled: true, lastTriggered: '1h ago', fireCount: 22 },
        { id: '5', name: 'Liquidation Cascade', type: 'liquidation', condition: 'Liquidations > $5M in 5min', severity: 'critical', enabled: false, lastTriggered: '3d ago', fireCount: 1 },
      ])

      // Generate triggered alerts
      setTriggered([
        { id: 't1', ruleId: '3', ruleName: 'Large DEX Swap', severity: 'critical', message: 'SWAP 42.3 ETH → 137,240 USDC on Uniswap V3', value: 137240, txHash: '0xabc123def456789', timestamp: '14:23:01' },
        { id: 't2', ruleId: '1', ruleName: 'Whale Wallet Monitor', severity: 'high', message: 'Binance Hot Wallet transferred 500 ETH ($866K)', value: 866000, txHash: '0xdef789abc012345', timestamp: '14:20:15' },
        { id: 't3', ruleId: '4', ruleName: 'Smart Money Signal', severity: 'high', message: 'Top wallet accumulated 1,200 ETH ($2.08M)', value: 2080000, timestamp: '14:18:30' },
        { id: 't4', ruleId: '2', ruleName: 'BTC Price Alert', severity: 'medium', message: 'BTC reached $64,500 (threshold: $64,000)', value: 64500, timestamp: '14:15:00' },
        { id: 't5', ruleId: '3', ruleName: 'Large DEX Swap', severity: 'critical', message: 'SWAP 2.1M USDC → 645 ETH on Curve', value: 2100000, txHash: '0xghi345jkl678901', timestamp: '14:12:45' },
      ])

      setFeedStatus('live')
    } catch {
      setFeedStatus('error')
    }
  }, [])

  useEffect(() => {
    const invoke = () => fetchAlerts()
    invoke()
    const interval = setInterval(fetchAlerts, 30_000)
    return () => clearInterval(interval)
  }, [fetchAlerts])

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">Alerts</h1>
            <p className="text-[11px] text-text-muted font-mono">Configurable on-chain alert engine</p>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot status={feedStatus} label />
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-3 py-1.5 rounded bg-teal-dim/30 text-teal-vivid text-[11px] font-mono hover:bg-teal-dim/50 transition-colors"
            >
              + New Alert
            </button>
          </div>
        </div>

        {/* Create Alert Form (toggle) */}
        {showCreate && (
          <Panel title="Create Alert" subtitle="Configure new alert rule">
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-text-muted font-mono block mb-1">ALERT NAME</label>
                  <input className="w-full bg-bg-raised border border-bg-border rounded px-2 py-1.5 text-[11px] font-mono text-text-primary" placeholder="My Alert" />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted font-mono block mb-1">TYPE</label>
                  <select className="w-full bg-bg-raised border border-bg-border rounded px-2 py-1.5 text-[11px] font-mono text-text-primary">
                    <option>Wallet Movement</option>
                    <option>Price Threshold</option>
                    <option>Large Swap</option>
                    <option>Smart Money Signal</option>
                    <option>Liquidation</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">CONDITION</label>
                <input className="w-full bg-bg-raised border border-bg-border rounded px-2 py-1.5 text-[11px] font-mono text-text-primary" placeholder="e.g., transfers > $500K" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded text-[11px] font-mono text-text-muted hover:text-text-secondary">Cancel</button>
                <button className="px-3 py-1.5 rounded bg-teal-vivid text-bg-base text-[11px] font-mono font-bold">Create Alert</button>
              </div>
            </div>
          </Panel>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
          {/* Alert Rules */}
          <Panel
            title="Alert Rules"
            subtitle={`${rules.filter(r => r.enabled).length} active`}
            liveStatus={feedStatus}
            maxHeight={500}
          >
            <div className="space-y-0">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 px-3 py-2 border-b border-bg-border/50 hover:bg-bg-raised/50 transition-colors"
                >
                  <AlertPill severity={rule.severity} size="xs" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-text-primary">{rule.name}</div>
                    <div className="text-[10px] text-text-muted font-mono">{rule.condition}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-text-muted">Last: {rule.lastTriggered}</div>
                    <div className="text-[10px] text-text-muted">Fires: {rule.fireCount}</div>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${rule.enabled ? 'bg-data-bull' : 'bg-text-muted'}`} />
                </div>
              ))}
            </div>
          </Panel>

          {/* Triggered Alerts */}
          <Panel
            title="Triggered Alerts"
            subtitle={`${triggered.length} recent`}
            liveStatus={feedStatus}
            maxHeight={500}
          >
            <div className="space-y-0">
              {triggered.map((alert) => (
                <div
                  key={alert.id}
                  className="px-3 py-2 border-b border-bg-border/50 hover:bg-bg-raised/50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AlertPill severity={alert.severity} size="xs" />
                    <span className="text-[10px] text-text-muted font-mono">{alert.timestamp}</span>
                    <span className="text-[10px] text-text-secondary">{alert.ruleName}</span>
                  </div>
                  <div className="text-[11px] font-mono text-text-primary">{alert.message}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {alert.value && <PriceTag value={alert.value} size="xs" />}
                    {alert.txHash && <TxHash hash={alert.txHash} truncate={6} />}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
