"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

interface ServiceStatus {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  details?: string
  category?: 'core' | 'crypto' | 'tradfi' | 'macro'
}

interface StatusData {
  status: string
  timestamp: string
  services: ServiceStatus[]
  byCategory?: {
    core: ServiceStatus[]
    crypto: ServiceStatus[]
    tradfi: ServiceStatus[]
    macro: ServiceStatus[]
  }
  summary?: {
    total: number
    healthy: number
    degraded: number
    down: number
  }
  uptime: number
}

const CATEGORY_LABELS: Record<string, string> = {
  core: 'CORE INFRASTRUCTURE',
  crypto: 'CRYPTO DATA SOURCES',
  tradfi: 'TRADFI DATA SOURCES',
  macro: 'MACRO DATA SOURCES',
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/v1/status')
      const json = await res.json()
      setData(json.data)
    } catch {
      // Silent fail
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const invoke = () => fetchStatus()
    invoke()
    const interval = setInterval(fetchStatus, 15_000) // Refresh every 15s
    return () => clearInterval(interval)
  }, [])

  const statusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-accent-green'
      case 'degraded': return 'text-accent-amber'
      case 'down': return 'text-data-bear'
      default: return 'text-text-dim'
    }
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-accent-green'
      case 'degraded': return 'bg-accent-amber'
      case 'down': return 'bg-data-bear'
      default: return 'bg-text-dim'
    }
  }

  const renderService = (service: ServiceStatus) => (
    <div
      key={service.name}
      className="flex items-center justify-between bg-bg-panel border border-border-dim rounded px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${statusDot(service.status)}`} />
        <span className="text-sm font-mono text-text-bright">{service.name}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-text-dim font-mono">{service.latencyMs}ms</span>
        <span className={`text-xs font-mono ${statusColor(service.status)}`}>
          {service.status.toUpperCase()}
        </span>
        {service.details && (
          <span className="text-xs text-text-dim">{service.details}</span>
        )}
      </div>
    </div>
  )

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="page-title">SYSTEM STATUS</h1>
          {data && (
            <span className={`text-sm font-mono ${statusColor(data.status)}`}>
              {data.status.toUpperCase()}
            </span>
          )}
        </div>

        {loading ? (
          <div className="text-text-dim text-xs">Checking services...</div>
        ) : !data ? (
          <div className="text-red-400 text-xs">Failed to fetch status</div>
        ) : (
          <>
            <div className="flex items-center gap-6 text-text-dim text-xs">
              <span>Last checked: {new Date(data.timestamp).toLocaleString()}</span>
              <span>Uptime: {Math.floor(data.uptime / 3600)}h {Math.floor((data.uptime % 3600) / 60)}m</span>
              {data.summary && (
                <>
                  <span className="text-accent-green">{data.summary.healthy} healthy</span>
                  {data.summary.degraded > 0 && <span className="text-accent-amber">{data.summary.degraded} degraded</span>}
                  {data.summary.down > 0 && <span className="text-data-bear">{data.summary.down} down</span>}
                </>
              )}
            </div>

            {/* Categorized view if byCategory available */}
            {data.byCategory ? (
              Object.entries(data.byCategory).map(([cat, services]) =>
                services.length > 0 ? (
                  <div key={cat}>
                    <h2 className="text-[10px] font-mono text-text-muted mb-2 uppercase tracking-wider">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </h2>
                    <div className="grid gap-2">
                      {services.map(renderService)}
                    </div>
                  </div>
                ) : null,
              )
            ) : (
              <div className="grid gap-2">
                {data.services.map(renderService)}
              </div>
            )}
          </>
        )}
      </div>
    </NexusLayout>
  )
}
