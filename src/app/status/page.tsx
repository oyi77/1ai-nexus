"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

interface ServiceStatus {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  details?: string
}

interface StatusData {
  status: string
  timestamp: string
  services: ServiceStatus[]
  uptime: number
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
      case 'healthy': return 'text-green-400'
      case 'degraded': return 'text-yellow-400'
      case 'down': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-400'
      case 'degraded': return 'bg-yellow-400'
      case 'down': return 'bg-red-400'
      default: return 'bg-gray-400'
    }
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">SYSTEM STATUS</h1>
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
            <div className="text-text-dim text-xs">
              Last checked: {new Date(data.timestamp).toLocaleString()} · Uptime: {Math.floor(data.uptime / 3600)}h {Math.floor((data.uptime % 3600) / 60)}m
            </div>

            <div className="grid gap-2">
              {data.services.map((service) => (
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
              ))}
            </div>
          </>
        )}
      </div>
    </NexusLayout>
  )
}
