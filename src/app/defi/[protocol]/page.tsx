"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { useParams } from "next/navigation"

export default function DeFiProtocolPage() {
  const params = useParams()
  const protocol = params?.protocol as string
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!protocol) return
    fetch(`/api/v1/modules/fetch?module=defillama&action=protocol&slug=${protocol}`)
      .then(r => r.json())
      .then(d => { setData(d.data ?? null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [protocol])

  return (
    <TerminalShell>
      <div className="p-4 space-y-4">
        <h1 className="text-sm font-bold text-accent-cyan">DeFi PROTOCOL</h1>
        <p className="text-xs text-text-dim">{protocol}</p>
        {loading ? <p className="text-text-dim text-xs">Loading from DeFiLlama...</p> : data ? (
          <div className="bg-bg-panel border border-border-dim rounded p-4 space-y-2">
            <p className="text-lg text-text-primary">{String(data.name ?? protocol)}</p>
            <p className="text-xs text-text-dim">Category: <span className="text-accent-cyan">{String(data.category ?? "—")}</span></p>
            <p className="text-xs text-text-dim">Chain: <span className="text-accent-cyan">{String(data.chain ?? "—")}</span></p>
          </div>
        ) : <p className="text-text-dim text-xs">Protocol not found on DeFiLlama</p>}
      </div>
    </TerminalShell>
  )
}
