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
  cex: 'text-accent-cyan',
  vc: 'text-accent-purple',
  whale: 'text-accent-amber',
  defi: 'text-accent-green',
  protocol: 'text-text-dim',
  dao: 'text-accent-amber',
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    // Load entity seeds
    import('@/lib/modules/ai-signals/entity-labels-seed').then(mod => {
      setEntities(mod.ENTITY_SEEDS)
    })
  }, [])

  const filtered = entities
    .filter(e => filter === 'all' || e.category === filter)
    .filter(e => !search || e.label.toLowerCase().includes(search.toLowerCase()) || e.address.toLowerCase().includes(search.toLowerCase()))

  const categories = [...new Set(entities.map(e => e.category))].sort()

  return (
    <TerminalShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">ENTITY EXPLORER</h1>
          <span className="text-xs text-text-dim">{entities.length} entities seeded</span>
        </div>

        {/* Search + Filter */}
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search entities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-bg-panel border border-border-dim rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 rounded text-[10px] border ${filter === 'all' ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'}`}
            >
              ALL
            </button>
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`px-2 py-0.5 rounded text-[10px] border ${filter === c ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'}`}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Entity Table */}
        <div className="bg-bg-panel border border-border-dim rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted border-b border-border-dim">
                <th className="text-left py-2 px-3 font-mono">LABEL</th>
                <th className="text-left py-2 px-3 font-mono">CATEGORY</th>
                <th className="text-left py-2 px-3 font-mono">CHAIN</th>
                <th className="text-left py-2 px-3 font-mono">ADDRESS</th>
                <th className="text-right py-2 px-3 font-mono">CONFIDENCE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className="border-b border-border-dim/30 hover:bg-bg-elevated cursor-pointer">
                  <td className="py-2 px-3 font-mono text-text-primary">{e.label}</td>
                  <td className={`py-2 px-3 ${CATEGORY_COLORS[e.category] ?? 'text-text-dim'}`}>{e.category}</td>
                  <td className="py-2 px-3 text-text-dim">{e.chain.toUpperCase()}</td>
                  <td className="py-2 px-3 font-mono text-text-dim truncate max-w-[200px]">{e.address}</td>
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
