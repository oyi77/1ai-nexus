"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { EntityGraph, type GraphData } from '@/components/features/EntityGraph'
import { LiveDot } from '@/components/primitives/LiveDot'

export default function KnowledgeGraphPage() {
  const [data, setData] = useState<GraphData | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  useEffect(() => {
    fetch('/api/v1/entities/graph')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setData(d.data as GraphData)
          setStatus('live')
        } else {
          setStatus('error')
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  return (
    <NexusLayout>
      <div className="p-4 h-full flex flex-col max-w-[1400px] mx-auto">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">🕸</span> Arkham Knowledge Graph
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">Interactive visualization of entity relationships and wallet nodes.</p>
          </div>
          <div className="flex items-center gap-2 bg-bg-panel px-3 py-1.5 border border-bg-border rounded">
            <LiveDot status={status} />
            <span className="text-[10px] font-mono text-text-muted">
              {data ? `${data.nodes.length} Nodes / ${data.links.length} Links` : 'Loading Topology...'}
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-[600px] relative">
          {data ? (
            <EntityGraph data={data} />
          ) : (
            <div className="w-full h-full bg-bg-panel border border-bg-border rounded flex items-center justify-center text-text-muted text-[12px] font-mono">
              Generating Force-Directed Graph...
            </div>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}
