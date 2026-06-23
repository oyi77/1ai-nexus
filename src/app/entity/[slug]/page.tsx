"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { useParams } from "next/navigation"

export default function EntityDetailPage() {
  const params = useParams()
  const slug = params?.slug as string
  const [entity, setEntity] = useState<{ label: string; category: string; address: string; chain: string; confidence: number } | null>(null)

  useEffect(() => {
    if (!slug) return
    import("@/lib/modules/ai-signals/entity-labels-seed").then(async (mod) => {
      const seeds = await mod.getEntitySeeds()
      const found = seeds.find(e => e.label.toLowerCase().replace(/[^a-z0-9]/g, "-") === slug)
      setEntity(found ?? null)
    })
  }, [slug])

  return (
    <TerminalShell>
      <div className="p-4 space-y-4">
        <h1 className="text-sm font-mono font-bold text-accent-cyan">ENTITY: {slug}</h1>
        {entity ? (
          <div className="bg-bg-panel border border-border-dim rounded p-4 space-y-2">
            <p className="text-lg font-mono text-text-primary">{entity.label}</p>
            <p className="text-xs text-text-dim">Category: <span className="text-accent-cyan">{entity.category}</span></p>
            <p className="text-xs text-text-dim">Chain: <span className="text-accent-cyan">{entity.chain.toUpperCase()}</span></p>
            <p className="text-xs text-text-dim">Address: <span className="font-mono text-text-primary">{entity.address}</span></p>
            <p className="text-xs text-text-dim">Confidence: <span className="text-accent-green">{((entity.confidence ?? 0) * 100).toFixed(0)}%</span></p>
          </div>
        ) : (
          <p className="text-text-dim text-xs">Entity not found in label database</p>
        )}
      </div>
    </TerminalShell>
  )
}
