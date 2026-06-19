"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"

interface Entity {
  address: string
  chain: string
  label: string
  category: string
  confidence: number
}

const CATEGORY_COLORS: Record<string, string> = {
  cex: 'bg-blue-900/30 text-blue-400',
  vc: 'bg-purple-900/30 text-purple-400',
  whale: 'bg-amber-900/30 text-amber-400',
  defi: 'bg-green-900/30 text-green-400',
  protocol: 'bg-gray-800 text-gray-400',
  dao: 'bg-cyan-900/30 text-cyan-400',
}

const CATEGORY_ICONS: Record<string, string> = {
  cex: '🏦', vc: '💼', whale: '🐋', defi: '🔗', protocol: '📄', dao: '🏛️',
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([])
  const [filter, setFilter] = useState('all')
  const [chainFilter, setChainFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    import('@/lib/modules/ai-signals/entity-labels-seed').then(mod => {
      setEntities(mod.ENTITY_SEEDS)
    })
  }, [])

  const categories = [...new Set(entities.map(e => e.category))].sort()
  const chains = [...new Set(entities.map(e => e.chain))].sort()

  const filtered = entities
    .filter(e => filter === 'all' || e.category === filter)
    .filter(e => chainFilter === 'all' || e.chain === chainFilter)
    .filter(e => !search || e.label.toLowerCase().includes(search.toLowerCase()) || e.address.toLowerCase().includes(search.toLowerCase()))

  const categoryCounts = categories.map(c => ({
    category: c,
    icon: CATEGORY_ICONS[c] ?? '📊',
    count: entities.filter(e => e.category === c).length,
  }))

  return (
    <TerminalShell>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan">ENTITY EXPLORER</h1>
          <span className="text-[10px] text-text-muted">{entities.length} entities · {chains.length} chains</span>
        </div>

        {/* Category Summary Cards */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {categoryCounts.map(c => (
            <button
              key={c.category}
              onClick={() => setFilter(filter === c.category ? 'all' : c.category)}
              className={`bg-bg-panel border rounded p-2 text-center transition-colors ${
                filter === c.category ? 'border-accent-cyan' : 'border-border-dim hover:border-border-active'
              }`}
            >
              <p className="text-lg">{c.icon}</p>
              <p className="text-[10px] text-text-muted uppercase">{c.category}</p>
              <p className="text-sm font-mono font-bold text-text-primary">{c.count}</p>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search entities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] bg-bg-panel border border-border-dim rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setChainFilter('all')}
              className={`px-2 py-0.5 rounded text-[10px] border ${chainFilter === 'all' ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'}`}
            >ALL CHAINS</button>
            {chains.map(c => (
              <button
                key={c}
                onClick={() => setChainFilter(c)}
                className={`px-2 py-0.5 rounded text-[10px] border ${chainFilter === c ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'}`}
              >{c.toUpperCase()}</button>
            ))}
          </div>
        </div>

        {/* Entity Table */}
        <div className="bg-bg-panel border border-border-dim rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted text-[10px] uppercase border-b border-border-dim">
                <th className="text-left py-2 px-3 font-mono">#</th>
                <th className="text-left py-2 px-3 font-mono">LABEL</th>
                <th className="text-left py-2 px-3 font-mono">CATEGORY</th>
                <th className="text-left py-2 px-3 font-mono">CHAIN</th>
                <th className="text-left py-2 px-3 font-mono">ADDRESS</th>
                <th className="text-right py-2 px-3 font-mono">CONFIDENCE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={e.address + e.chain + i} className="border-b border-border-dim/30 hover:bg-bg-elevated cursor-pointer">
                  <td className="py-2 px-3 text-text-muted">{i + 1}</td>
                  <td className="py-2 px-3 font-mono text-text-primary">{e.label}</td>
                  <td className="py-2 px-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_COLORS[e.category] ?? 'bg-gray-800 text-gray-400'}`}>
                      {CATEGORY_ICONS[e.category] ?? '📊'} {e.category}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-accent-cyan">{e.chain.toUpperCase()}</td>
                  <td className="py-2 px-3 font-mono text-text-dim truncate max-w-[180px]">{e.address}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`font-mono ${e.confidence >= 0.9 ? 'text-accent-green' : e.confidence >= 0.7 ? 'text-accent-amber' : 'text-text-dim'}`}>
                      {(e.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </TerminalShell>
  )
}
