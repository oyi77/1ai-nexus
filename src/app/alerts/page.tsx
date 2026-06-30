"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Alert {
  id: string
  name: string
  condition: string
  channel: 'whatsapp' | 'telegram' | 'email' | 'push'
  enabled: boolean
  lastTriggered: string | null
}

// Alerts start empty — users create their own
// In production, alerts are persisted to database


const CHANNEL_INFO: Record<string, { name: string; icon: string; color: string; description: string }> = {
  whatsapp: { name: 'WhatsApp', icon: '📱', color: '#25d366', description: 'Instant delivery to your WhatsApp number' },
  telegram: { name: 'Telegram', icon: '✈️', color: '#0088cc', description: 'Fast delivery via Telegram bot' },
  email: { name: 'Email', icon: '📧', color: '#ea4335', description: 'Detailed alert via email' },
  push: { name: 'Push', icon: '🔔', color: '#f59e0b', description: 'Browser push notification' },
}

export default function AlertsPage() {

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newAlert, setNewAlert] = useState({ name: '', condition: '', channel: 'whatsapp' as Alert['channel'] })

  const toggleAlert = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a))
  }

  const deleteAlert = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  const createAlert = () => {
    if (!newAlert.name || !newAlert.condition) return
    const alert: Alert = {
      id: Date.now().toString(),
      name: newAlert.name,
      condition: newAlert.condition,
      channel: newAlert.channel,
      enabled: true,
      lastTriggered: null,
    }
    setAlerts(prev => [...prev, alert])
    setNewAlert({ name: '', condition: '', channel: 'whatsapp' })
    setShowCreate(false)
  }

  const enabledCount = alerts.filter(a => a.enabled).length
  const channelCounts = alerts.reduce((acc, a) => {
    acc[a.channel] = (acc[a.channel] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">ALERT CENTER</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {enabledCount} active alerts across {Object.keys(channelCounts).length} channels
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot status="live" label />
            <button onClick={() => setShowCreate(!showCreate)}
              className="px-3 py-1.5 text-xs font-mono bg-teal-vivid text-bg-base rounded hover:bg-teal-vivid/80">
              + New Alert
            </button>
          </div>
        </div>

        {/* Channel Overview */}
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(CHANNEL_INFO).map(([key, info]) => (
            <div key={key} className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span>{info.icon}</span>
                <span className="text-xs font-mono text-text-primary">{info.name}</span>
              </div>
              <p className="text-lg font-bold font-mono text-text-primary">{channelCounts[key] ?? 0}</p>
              <p className="text-[9px] text-text-muted">{info.description}</p>
            </div>
          ))}
        </div>

        {/* Create Alert Form */}
        {showCreate && (
          <div className="bg-bg-panel border border-teal-vivid rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">CREATE NEW ALERT</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Alert Name</label>
                <input
                  type="text"
                  value={newAlert.name}
                  onChange={e => setNewAlert(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., BTC Breakout"
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Condition</label>
                <input
                  type="text"
                  value={newAlert.condition}
                  onChange={e => setNewAlert(prev => ({ ...prev, condition: e.target.value }))}
                  placeholder="e.g., BTC-USD > $75,000"
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Channel</label>
                <select
                  value={newAlert.channel}
                  onChange={e => setNewAlert(prev => ({ ...prev, channel: e.target.value as Alert['channel'] }))}
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                >
                  {Object.entries(CHANNEL_INFO).map(([key, info]) => (
                    <option key={key} value={key}>{info.icon} {info.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
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

        {/* Alerts List */}
        <div className="space-y-2">
          {alerts.map(alert => (
            <div key={alert.id} className={`bg-bg-panel border rounded-lg p-4 transition-colors ${
              alert.enabled ? 'border-border-dim hover:border-border-active' : 'border-border-dim/50 opacity-60'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleAlert(alert.id)}
                    className={`w-10 h-5 rounded-full transition-colors ${
                      alert.enabled ? 'bg-teal-vivid' : 'bg-bg-elevated'
                    }`}>
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      alert.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                  <div>
                    <p className="text-sm font-mono text-text-primary">{alert.name}</p>
                    <p className="text-[10px] text-text-muted font-mono">{alert.condition}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{
                    backgroundColor: CHANNEL_INFO[alert.channel].color + '20',
                    color: CHANNEL_INFO[alert.channel].color,
                  }}>
                    {CHANNEL_INFO[alert.channel].icon} {CHANNEL_INFO[alert.channel].name}
                  </span>
                  {alert.lastTriggered && (
                    <span className="text-[9px] text-text-muted font-mono">
                      Last: {alert.lastTriggered}
                    </span>
                  )}
                  <button onClick={() => deleteAlert(alert.id)}
                    className="text-[10px] font-mono text-data-bear hover:text-data-bear/80">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* WhatsApp Setup Guide */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">WHATSAPP SETUP</h2>
          <div className="text-xs text-text-dim space-y-2">
            <p>To receive alerts on WhatsApp:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Connect your WhatsApp number in Settings</li>
              <li>Send "JOIN nexus" to the NEXUS WhatsApp bot number</li>
              <li>Confirm your subscription via the verification code</li>
              <li>Alerts will be delivered instantly to your WhatsApp</li>
            </ol>
            <p className="text-[10px] text-text-muted mt-2">
              WhatsApp Business API integration. Alerts are delivered via the official WhatsApp Business API for reliable, instant delivery.
            </p>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
