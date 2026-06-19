"use client"

import { useState, useEffect } from "react"

interface ModuleInfo {
  id: string
  name: string
  category: string
  sourceType: string
  status: string
  provenance: {
    describesItself: string
    upstreamProduct?: string
    fragility: string
    lastVerified: string
    toleratesAbsence: boolean
  }
  lastChecked?: string
  lastSuccess?: string
  failureCount: number
  notes?: string
}

const SOURCE_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  'public-api':  { label: 'Public API',       color: 'bg-green-900/40 text-green-400 border-green-800' },
  'public-rpc':  { label: 'Public RPC',        color: 'bg-green-900/40 text-green-400 border-green-800' },
  'oss-mirror':  { label: 'OSS Mirror',        color: 'bg-blue-900/40 text-blue-400 border-blue-800' },
  're':          { label: 'RE',                color: 'bg-amber-900/40 text-amber-400 border-amber-800' },
  'derived':     { label: 'Derived',           color: 'bg-purple-900/40 text-purple-400 border-purple-800' },
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  active:   { label: '✅ Active',    color: 'text-green-400' },
  degraded: { label: '⚠️ Degraded',  color: 'text-amber-400' },
  offline:  { label: '❌ Offline',   color: 'text-red-400' },
}

export default function ModulesPage() {
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("all")

  useEffect(() => {
    fetch('/api/v1/modules')
      .then(r => r.json())
      .then(d => { setModules(d.modules ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = filter === 'all' ? modules : modules.filter(m => m.sourceType === filter)

  const categories = [...new Set(modules.map(m => m.category))].sort()

  return (
    <div className="min-h-screen bg-[#080b0f] text-[#dce8f0] p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold font-[family-name:var(--font-head)]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            ⚙ Module Settings
          </h1>
          <p className="text-[#5a7a94] mt-1">
            {modules.length} modules registered · {modules.filter(m => m.status === 'active').length} active ·{' '}
            {modules.filter(m => m.status === 'degraded').length} degraded ·{' '}
            {modules.filter(m => m.status === 'offline').length} offline
          </p>
        </header>

        {/* Filter pills */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['all', 'public-api', 'public-rpc', 'oss-mirror', 're', 'derived'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-xs border transition-colors ${
                filter === f
                  ? 'bg-[#2a3f55] border-[#2a3f55] text-white'
                  : 'bg-[#0d1117] border-[#1c2430] text-[#5a7a94] hover:border-[#2a3f55]'
              }`}
            >
              {f === 'all' ? 'All' : SOURCE_TYPE_BADGE[f]?.label ?? f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-[#5a7a94] py-20">Loading modules...</div>
        ) : (
          <div className="space-y-3">
            {categories.map(cat => {
              const catModules = filtered.filter(m => m.category === cat)
              if (catModules.length === 0) return null
              return (
                <div key={cat}>
                  <h2 className="text-xs uppercase tracking-wider text-[#5a7a94] mb-2 mt-6 first:mt-0">
                    {cat}
                  </h2>
                  <div className="space-y-1">
                    {catModules.map(m => (
                      <ModuleRow key={m.id} module={m} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ModuleRow({ module: m }: { module: ModuleInfo }) {
  const [expanded, setExpanded] = useState(false)
  const badge = SOURCE_TYPE_BADGE[m.sourceType] ?? { label: m.sourceType, color: 'bg-gray-800 text-gray-400' }
  const status = STATUS_BADGE[m.status] ?? STATUS_BADGE.offline

  return (
    <div className="bg-[#0d1117] border border-[#1c2430] rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#131920] transition-colors rounded-lg"
      >
        <span className={status.color}>{status.label}</span>
        <span className="font-medium text-sm flex-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {m.name}
        </span>
        <span className={`px-2 py-0.5 rounded text-[10px] border ${badge.color}`}>
          {badge.label}
        </span>
        {m.sourceType === 're' && (
          <span className="text-[10px] text-amber-400/60">⚠️ Unofficial</span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 pt-0 text-xs text-[#5a7a94] space-y-1 border-t border-[#1c2430]">
          <p className="text-[#dce8f0] mt-2">{m.provenance.describesItself}</p>
          {m.provenance.upstreamProduct && (
            <p>Replaces: <span className="text-[#dce8f0]">{m.provenance.upstreamProduct}</span></p>
          )}
          <p>Fragility: <span className="text-[#dce8f0]">{m.provenance.fragility}</span></p>
          <p>Last verified: <span className="text-[#dce8f0]">{m.provenance.lastVerified}</span></p>
          {m.lastChecked && <p>Last checked: <span className="text-[#dce8f0]">{new Date(m.lastChecked).toLocaleString()}</span></p>}
          {m.lastSuccess && <p>Last success: <span className="text-[#dce8f0]">{new Date(m.lastSuccess).toLocaleString()}</span></p>}
          {m.failureCount > 0 && <p className="text-amber-400">Failures: {m.failureCount}</p>}
          {m.notes && <p className="text-amber-400">{m.notes}</p>}
          <p>ID: <code className="text-[#00c8ff]">{m.id}</code></p>
        </div>
      )}
    </div>
  )
}
