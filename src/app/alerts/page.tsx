"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { Bell, Plus } from "lucide-react"

interface AlertTemplate {
  id: string
  name: string
  description: string
  icon: string
  condition: string
  category: string
}

export default function AlertsPage() {
  const [templates, setTemplates] = useState<AlertTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    fetch('/api/v1/alerts/templates')
      .then(r => r.json())
      .then(d => { setTemplates(d.templates ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const categories = [...new Set(templates.map(t => t.category))].sort()
  const filtered = filter === 'all' ? templates : templates.filter(t => t.category === filter)

  return (
    <TerminalShell>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
            <Bell size={14} /> ALERT TEMPLATES
          </h1>
          <span className="text-[10px] text-text-muted">{templates.length} templates</span>
        </div>

        {/* Category filter */}
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 rounded text-[10px] border ${filter === 'all' ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'}`}
          >ALL</button>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-2 py-0.5 rounded text-[10px] border ${filter === c ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'}`}
            >{c.toUpperCase()}</button>
          ))}
        </div>

        {/* Template Grid */}
        {loading ? (
          <div className="text-center py-20 text-text-dim text-xs">Loading alert templates...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(t => (
              <div key={t.id} className="bg-bg-panel border border-border-dim rounded-lg p-3 hover:border-border-active transition-colors cursor-pointer">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{t.icon}</span>
                  <span className="font-mono text-xs text-text-primary">{t.name}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-bg-elevated text-text-dim ml-auto">{t.category}</span>
                </div>
                <p className="text-[11px] text-text-dim leading-tight">{t.description}</p>
                <div className="mt-2 flex items-center justify-between">
                  <code className="text-[9px] text-accent-cyan font-mono">{t.condition}</code>
                  <button className="text-[10px] px-2 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30 hover:bg-accent-cyan/30 transition-colors flex items-center gap-1">
                    <Plus size={10} /> CREATE
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TerminalShell>
  )
}
