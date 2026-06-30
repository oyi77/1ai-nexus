"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

// ─── Alert types ──────────────────────────────────────────

type AlertType = 'price_threshold' | 'forex_rate' | 'macro_event' | 'wallet_moved' | 'smart_money_action' | 'prediction_threshold'
type Channel = 'whatsapp' | 'telegram' | 'email' | 'push'

interface Alert {
  id: string
  type: AlertType
  name: string
  description: string
  channel: Channel
  enabled: boolean
  lastTriggered: string | null
  // Type-specific fields stored as JSON
  config: Record<string, unknown>
}

interface AlertLogEntry {
  alertId: string
  alertName: string
  triggeredAt: number
  value: unknown
  message: string
}

const ALERT_TYPES: Record<AlertType, { label: string; icon: string; description: string; category: 'tradfi' | 'crypto' }> = {
  price_threshold:        { label: 'Price Alert',     icon: '📈', description: 'Stock, commodity, or index crosses a price level', category: 'tradfi' },
  forex_rate:             { label: 'Forex Rate',      icon: '💱', description: 'Currency pair crosses a rate threshold', category: 'tradfi' },
  macro_event:            { label: 'Macro Event',     icon: '🏛', description: 'Economic indicator released (FOMC, CPI, NFP, BI Rate)', category: 'tradfi' },
  wallet_moved:           { label: 'Wallet Move',     icon: '🐋', description: 'Whale wallet moves above amount threshold', category: 'crypto' },
  smart_money_action:     { label: 'Smart Money',     icon: '🧠', description: 'Smart money accumulates, exits, bridges, or swaps', category: 'crypto' },
  prediction_threshold:   { label: 'Prediction',      icon: '🎯', description: 'Prediction market price crosses threshold', category: 'crypto' },
}

const CHANNEL_INFO: Record<Channel, { name: string; color: string; description: string }> = {
  whatsapp: { name: 'WhatsApp', color: '#25d366', description: 'Instant delivery to WhatsApp' },
  telegram: { name: 'Telegram', color: '#0088cc', description: 'Fast delivery via Telegram bot' },
  email:    { name: 'Email',    color: '#ea4335', description: 'Detailed alert via email' },
  push:     { name: 'Push',     color: '#f59e0b', description: 'Browser push notification' },
}

// ─── Preset templates ─────────────────────────────────────

const PRESETS: Array<{ name: string; type: AlertType; config: Record<string, unknown>; channel: Channel }> = [
  { name: 'S&P 500 below 5000', type: 'price_threshold', config: { symbol: '^GSPC', threshold: 5000, direction: 'below' }, channel: 'telegram' },
  { name: 'Gold above $3000', type: 'price_threshold', config: { symbol: 'GC=F', threshold: 3000, direction: 'above' }, channel: 'telegram' },
  { name: 'USD/IDR above 16500', type: 'forex_rate', config: { pair: 'USD/IDR', threshold: 16500, direction: 'above' }, channel: 'whatsapp' },
  { name: 'EUR/USD below 1.05', type: 'forex_rate', config: { pair: 'EUR/USD', threshold: 1.05, direction: 'below' }, channel: 'telegram' },
  { name: 'FOMC Rate Decision', type: 'macro_event', config: { event: 'FOMC Rate Decision', country: 'US' }, channel: 'whatsapp' },
  { name: 'BI Rate Decision', type: 'macro_event', config: { event: 'BI Rate Decision (RDG)', country: 'ID' }, channel: 'whatsapp' },
  { name: 'US CPI Release', type: 'macro_event', config: { event: 'CPI (YoY)', country: 'US' }, channel: 'telegram' },
  { name: 'BTC Whale > $10M', type: 'wallet_moved', config: { address: '', minAmountUsd: 10_000_000 }, channel: 'telegram' },
]

// ─── Form components per alert type ───────────────────────

function PriceThresholdForm({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Symbol</label>
        <input type="text" value={String(config.symbol ?? '')} onChange={e => onChange({ ...config, symbol: e.target.value.toUpperCase() })}
          placeholder="AAPL, GC=F, ^GSPC" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Price Threshold</label>
        <input type="number" value={String(config.threshold ?? '')} onChange={e => onChange({ ...config, threshold: parseFloat(e.target.value) || 0 })}
          placeholder="150.00" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Direction</label>
        <select value={String(config.direction ?? 'above')} onChange={e => onChange({ ...config, direction: e.target.value })}
          className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
          <option value="above">Above threshold</option>
          <option value="below">Below threshold</option>
        </select>
      </div>
    </div>
  )
}

function ForexRateForm({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const pairs = ['USD/IDR', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CNY', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'USD/SGD', 'USD/KRW', 'USD/THB', 'USD/MYR']
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Currency Pair</label>
        <select value={String(config.pair ?? 'USD/IDR')} onChange={e => onChange({ ...config, pair: e.target.value })}
          className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
          {pairs.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Rate Threshold</label>
        <input type="number" value={String(config.threshold ?? '')} onChange={e => onChange({ ...config, threshold: parseFloat(e.target.value) || 0 })}
          placeholder="16000" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Direction</label>
        <select value={String(config.direction ?? 'above')} onChange={e => onChange({ ...config, direction: e.target.value })}
          className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
          <option value="above">Above threshold</option>
          <option value="below">Below threshold</option>
        </select>
      </div>
    </div>
  )
}

function MacroEventForm({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const events = [
    { event: 'FOMC Rate Decision', country: 'US' },
    { event: 'Non-Farm Payrolls', country: 'US' },
    { event: 'CPI (YoY)', country: 'US' },
    { event: 'GDP (Advance Estimate)', country: 'US' },
    { event: 'PCE Price Index', country: 'US' },
    { event: 'ISM Manufacturing PMI', country: 'US' },
    { event: 'ECB Rate Decision', country: 'EU' },
    { event: 'BOJ Rate Decision', country: 'JP' },
    { event: 'BI Rate Decision (RDG)', country: 'ID' },
    { event: 'BOE Rate Decision', country: 'GB' },
    { event: 'RBA Rate Decision', country: 'AU' },
    { event: 'PBOC LPR Decision', country: 'CN' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Economic Event</label>
        <select value={String(config.event ?? events[0].event)} onChange={e => {
          const sel = events.find(ev => ev.event === e.target.value)
          onChange({ ...config, event: e.target.value, country: sel?.country ?? '' })
        }}
          className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
          {events.map(ev => <option key={ev.event} value={ev.event}>{ev.country} — {ev.event}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Country</label>
        <input type="text" value={String(config.country ?? '')} readOnly
          className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-muted" />
      </div>
    </div>
  )
}

function WalletMovedForm({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Wallet Address (optional)</label>
        <input type="text" value={String(config.address ?? '')} onChange={e => onChange({ ...config, address: e.target.value })}
          placeholder="0x... (leave empty for any whale)" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Min Amount (USD)</label>
        <input type="number" value={String(config.minAmountUsd ?? 1000000)} onChange={e => onChange({ ...config, minAmountUsd: parseFloat(e.target.value) || 0 })}
          placeholder="1000000" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
    </div>
  )
}

function SmartMoneyForm({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Action</label>
        <select value={String(config.action ?? 'Accumulated')} onChange={e => onChange({ ...config, action: e.target.value })}
          className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
          <option value="Accumulated">Accumulated</option>
          <option value="Exited">Exited</option>
          <option value="Bridged">Bridged</option>
          <option value="Swapped">Swapped</option>
        </select>
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Min Score (0-100)</label>
        <input type="number" value={String(config.minScore ?? 70)} onChange={e => onChange({ ...config, minScore: parseInt(e.target.value) || 0 })}
          placeholder="70" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
    </div>
  )
}

function PredictionThresholdForm({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Market ID</label>
        <input type="text" value={String(config.marketId ?? '')} onChange={e => onChange({ ...config, marketId: e.target.value })}
          placeholder="Polymarket market ID" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Price Threshold</label>
        <input type="number" value={String(config.threshold ?? '')} onChange={e => onChange({ ...config, threshold: parseFloat(e.target.value) || 0 })}
          placeholder="0.70" step="0.01" className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
      </div>
      <div>
        <label className="text-[10px] text-text-muted font-mono block mb-1">Direction</label>
        <select value={String(config.direction ?? 'above')} onChange={e => onChange({ ...config, direction: e.target.value })}
          className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
          <option value="above">Above threshold</option>
          <option value="below">Below threshold</option>
        </select>
      </div>
    </div>
  )
}

function AlertTypeForm({ type, config, onChange }: { type: AlertType; config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  switch (type) {
    case 'price_threshold': return <PriceThresholdForm config={config} onChange={onChange} />
    case 'forex_rate': return <ForexRateForm config={config} onChange={onChange} />
    case 'macro_event': return <MacroEventForm config={config} onChange={onChange} />
    case 'wallet_moved': return <WalletMovedForm config={config} onChange={onChange} />
    case 'smart_money_action': return <SmartMoneyForm config={config} onChange={onChange} />
    case 'prediction_threshold': return <PredictionThresholdForm config={config} onChange={onChange} />
    default: return null
  }
}

// ─── Description builder ──────────────────────────────────

function describeAlert(alert: Alert): string {
  const c = alert.config
  switch (alert.type) {
    case 'price_threshold':
      return `${c.symbol} ${c.direction === 'above' ? '>' : '<'} ${c.threshold}`
    case 'forex_rate':
      return `${c.pair} ${c.direction === 'above' ? '>' : '<'} ${c.threshold}`
    case 'macro_event':
      return `${c.country} — ${c.event}`
    case 'wallet_moved':
      return `Any wallet moves >= $${Number(c.minAmountUsd).toLocaleString()}${c.address ? ` (${String(c.address).slice(0, 8)}...)` : ''}`
    case 'smart_money_action':
      return `Smart money ${c.action} (score >= ${c.minScore})`
    case 'prediction_threshold':
      return `Market ${String(c.marketId).slice(0, 12)}... ${c.direction === 'above' ? '>' : '<'} ${c.threshold}`
    default:
      return alert.name
  }
}

// ─── Main page ────────────────────────────────────────────

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [alertType, setAlertType] = useState<AlertType>('price_threshold')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [channel, setChannel] = useState<Channel>('telegram')
  const [filterCategory, setFilterCategory] = useState<'all' | 'tradfi' | 'crypto'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [evalSummary, setEvalSummary] = useState<{ evaluated: number; triggered: number; results: Array<{ id: string; type: string; triggered: boolean; message: string; fired: boolean; deliveryStatus: string; deliveryError?: string }> } | null>(null)
  const [alertLog, setAlertLog] = useState<AlertLogEntry[]>([])

  useEffect(() => {
    fetch('/api/v1/alerts')
      .then(r => r.json())
      .then(d => { if (d.data) setAlerts(d.data); else setError(d.error ?? 'Failed to load alerts') })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/v1/alerts/log')
      .then(r => r.json())
      .then(d => { if (d.data?.log) setAlertLog(d.data.log) })
      .catch(() => {})
  }, [])

  const toggleAlert = useCallback(async (id: string) => {
    setError(null)
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a))
    try {
      const res = await fetch('/api/v1/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      if (!res.ok) throw new Error('Toggle failed')
    } catch (e) {
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a))
      setError((e as Error).message)
    }
  }, [])

  const deleteAlert = useCallback(async (id: string) => {
    setError(null)
    const prev = alerts
    setAlerts(a => a.filter(x => x.id !== id))
    try {
      const res = await fetch(`/api/v1/alerts?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
    } catch (e) {
      setAlerts(prev)
      setError((e as Error).message)
    }
  }, [alerts])

  const createAlert = useCallback(async () => {
    const meta = ALERT_TYPES[alertType]
    const body = { type: alertType, name: meta.label, config, channel }
    setError(null)
    try {
      const res = await fetch('/api/v1/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok || !d.data) throw new Error(d.error ?? 'Failed to create alert')
      setAlerts(prev => [d.data, ...prev])
      setConfig({})
      setShowCreate(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [alertType, config, channel])

  const evaluateAlerts = useCallback(async () => {
    setEvaluating(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/alerts/evaluate')
      const d = await res.json()
      if (!res.ok || !d.data) throw new Error(d.error ?? 'Evaluation failed')
      setEvalSummary(d.data)
      const [alertsRes, logRes] = await Promise.all([fetch('/api/v1/alerts'), fetch('/api/v1/alerts/log')])
      const [alertsJson, logJson] = await Promise.all([alertsRes.json(), logRes.json()])
      if (alertsJson.data) setAlerts(alertsJson.data)
      if (logJson.data?.log) setAlertLog(logJson.data.log)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEvaluating(false)
    }
  }, [])

  const loadPreset = (preset: typeof PRESETS[0]) => {
    setAlertType(preset.type)
    setConfig(preset.config)
    setChannel(preset.channel)
    setShowCreate(true)
  }

  const enabledCount = alerts.filter(a => a.enabled).length
  const filteredAlerts = filterCategory === 'all' ? alerts : alerts.filter(a => ALERT_TYPES[a.type].category === filterCategory)

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">ALERT CENTER</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {enabledCount} active alert{enabledCount !== 1 ? 's' : ''} — Price, Forex, Macro, Whale, Smart Money
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot status="live" label />
            {alerts.length > 0 && (
              <button onClick={evaluateAlerts}
                className="px-3 py-1.5 text-xs font-mono bg-bg-elevated border border-border-dim text-text-primary rounded hover:border-border-active disabled:opacity-50"
                disabled={evaluating}>
                {evaluating ? 'Evaluating…' : 'Evaluate Now'}
              </button>
            )}
            <button onClick={() => { setShowCreate(!showCreate); setConfig({}) }}
              className="px-3 py-1.5 text-xs font-mono bg-teal-vivid text-bg-base rounded hover:bg-teal-vivid/80">
              + New Alert
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-bg-panel border border-data-bear/40 rounded-lg p-3 text-[11px] font-mono text-data-bear">
            {error}
          </div>
        )}

        {/* Quick presets */}
        {!showCreate && alerts.length === 0 && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">QUICK START — Popular Alerts</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PRESETS.map((preset, i) => (
                <button key={i} onClick={() => loadPreset(preset)}
                  className="text-left p-2 border border-border-dim/50 rounded hover:border-teal-vivid/50 hover:bg-bg-elevated transition-colors">
                  <p className="text-[11px] font-mono text-text-primary">{preset.name}</p>
                  <p className="text-[9px] text-text-muted mt-0.5">{ALERT_TYPES[preset.type].label} via {CHANNEL_INFO[preset.channel].name}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Create Alert Form */}
        {showCreate && (
          <div className="bg-bg-panel border border-teal-vivid rounded-lg p-4 space-y-4">
            <h3 className="text-xs font-mono text-accent-cyan">CREATE NEW ALERT</h3>

            {/* Alert type selector */}
            <div>
              <label className="text-[10px] text-text-muted font-mono block mb-2">Alert Type</label>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {(Object.entries(ALERT_TYPES) as Array<[AlertType, typeof ALERT_TYPES[AlertType]]>).map(([key, meta]) => (
                  <button key={key} onClick={() => { setAlertType(key); setConfig({}) }}
                    className={`text-left p-2 rounded border transition-colors ${
                      alertType === key ? 'border-teal-vivid bg-teal-vivid/10' : 'border-border-dim/50 hover:border-border-active'
                    }`}>
                    <p className="text-sm">{meta.icon}</p>
                    <p className="text-[10px] font-mono text-text-primary">{meta.label}</p>
                    <p className={`text-[8px] font-mono ${meta.category === 'tradfi' ? 'text-accent-cyan' : 'text-accent-amber'}`}>{meta.category.toUpperCase()}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Type-specific form */}
            <AlertTypeForm type={alertType} config={config} onChange={setConfig} />

            {/* Channel selector */}
            <div className="grid grid-cols-4 gap-2">
              {(Object.entries(CHANNEL_INFO) as Array<[Channel, typeof CHANNEL_INFO[Channel]]>).map(([key, info]) => (
                <button key={key} onClick={() => setChannel(key)}
                  className={`p-2 rounded border transition-colors ${
                    channel === key ? 'border-teal-vivid bg-teal-vivid/10' : 'border-border-dim/50 hover:border-border-active'
                  }`}>
                  <p className="text-[11px] font-mono text-text-primary">{info.name}</p>
                  <p className="text-[9px] text-text-muted">{info.description}</p>
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={createAlert}
                className="px-4 py-2 text-xs font-mono bg-teal-vivid text-bg-base rounded hover:bg-teal-vivid/80">
                Create Alert
              </button>
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-xs font-mono bg-bg-elevated border border-border-dim text-text-muted rounded hover:border-border-active">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        {alerts.length > 0 && (
          <div className="flex items-center gap-2">
            {(['all', 'tradfi', 'crypto'] as const).map(cat => (
              <button key={cat} onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1 text-[10px] font-mono rounded capitalize ${
                  filterCategory === cat ? 'bg-teal-dim/30 text-teal-vivid' : 'text-text-muted hover:text-text-secondary'
                }`}>
                {cat} ({cat === 'all' ? alerts.length : alerts.filter(a => ALERT_TYPES[a.type].category === cat).length})
              </button>
            ))}
          </div>
        )}

        {evalSummary && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-mono text-accent-cyan">LATEST EVALUATION</h3>
              <span className="text-[10px] font-mono text-text-muted">
                {evalSummary.triggered}/{evalSummary.evaluated} triggered
              </span>
            </div>
            <div className="space-y-1.5">
              {evalSummary.results.slice(0, 8).map((result) => (
                <div key={result.id} className="text-[10px] font-mono border-b border-border-dim/30 pb-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={result.triggered ? 'text-accent-green' : 'text-text-dim'}>
                        {result.triggered ? 'TRIGGERED' : 'SKIPPED'}
                      </span>
                      <span className="text-text-primary">{result.type}</span>
                    </div>
                    <span className="text-text-muted text-right">{result.message}</span>
                  </div>
                  <div className="mt-0.5 text-text-dim">
                    Delivery: {result.deliveryStatus}
                    {result.deliveryError ? ` — ${result.deliveryError}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alerts List */}
        <div className="space-y-2">
          {filteredAlerts.map(alert => (
            <div key={alert.id} className={`bg-bg-panel border rounded-lg p-4 transition-colors ${
              alert.enabled ? 'border-border-dim hover:border-border-active' : 'border-border-dim/50 opacity-60'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleAlert(alert.id)}
                    className={`w-10 h-5 rounded-full transition-colors ${alert.enabled ? 'bg-teal-vivid' : 'bg-bg-elevated'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${alert.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{ALERT_TYPES[alert.type].icon}</span>
                      <p className="text-sm font-mono text-text-primary">{alert.name}</p>
                      <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
                        ALERT_TYPES[alert.type].category === 'tradfi' ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-accent-amber/10 text-accent-amber'
                      }`}>
                        {ALERT_TYPES[alert.type].category.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-muted font-mono mt-0.5">{alert.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{
                    backgroundColor: CHANNEL_INFO[alert.channel].color + '20',
                    color: CHANNEL_INFO[alert.channel].color,
                  }}>
                    {CHANNEL_INFO[alert.channel].name}
                  </span>
                  {alert.lastTriggered && (
                    <span className="text-[9px] text-text-muted font-mono">Last: {alert.lastTriggered}</span>
                  )}
                  <button onClick={() => deleteAlert(alert.id)} className="text-[10px] font-mono text-data-bear hover:text-data-bear/80">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-mono text-accent-cyan">ALERT HISTORY</h2>
            <span className="text-[10px] font-mono text-text-muted">{alertLog.length} recent events</span>
          </div>
          {alertLog.length === 0 ? (
            <div className="text-[10px] text-text-muted font-mono">No alert events recorded yet.</div>
          ) : (
            <div className="space-y-1.5">
              {alertLog.slice().reverse().slice(0, 10).map((event) => (
                <div key={`${event.alertId}-${event.triggeredAt}`} className="flex items-start justify-between gap-3 text-[10px] font-mono border-b border-border-dim/30 pb-1">
                  <div>
                    <div className="text-text-primary">{event.alertName}</div>
                    <div className="text-text-muted">{event.message}</div>
                  </div>
                  <div className="text-right text-text-dim whitespace-nowrap">
                    {new Date(event.triggeredAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {alerts.length === 0 && !showCreate && (
          <div className="text-center py-12">
            <p className="text-text-muted text-sm font-mono">No alerts configured</p>
            <p className="text-text-dim text-xs mt-1">Click &quot;+ New Alert&quot; or use a Quick Start preset above</p>
          </div>
        )}

        {/* Delivery channels info */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">DELIVERY CHANNELS</h2>
          <div className="grid grid-cols-4 gap-4">
            {Object.entries(CHANNEL_INFO).map(([key, info]) => (
              <div key={key}>
                <p className="text-xs font-mono text-text-primary">{info.name}</p>
                <p className="text-[9px] text-text-muted">{info.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
