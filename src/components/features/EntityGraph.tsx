"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import { select } from 'd3-selection'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum } from 'd3-force'
import { drag } from 'd3-drag'
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import 'd3-transition'

interface GraphNode extends SimulationNodeDatum {
  id: string
  group: number
  label: string
  tvl: number
  type: 'entity' | 'wallet'
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  value: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

type SvgZoom = ZoomBehavior<SVGSVGElement, unknown>

const ZOOM_MIN = 0.1
const ZOOM_MAX = 8

export function EntityGraph({ data }: { data: GraphData }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<SvgZoom | null>(null)
  const transformRef = useRef(zoomIdentity)
  const highlightedRef = useRef<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [highlightedIds, setHighlightedIds] = useState<string[]>([])

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return

    const width = svgRef.current.clientWidth || 800
    const height = svgRef.current.clientHeight || 600

    const svgSel = select(svgRef.current)
    svgSel.selectAll('*').remove()

    const getColor = (group: number) => {
      switch (group) {
        case 1: return '#00b8d9'
        case 2: return '#f39c12'
        case 3: return '#6554c0'
        case 4: return '#ff5630'
        case 5: return '#36b37e'
        default: return '#888888'
      }
    }

    const simulation = forceSimulation<GraphNode>(data.nodes)
      .force('link', forceLink<GraphNode, GraphLink>(data.links).id(d => d.id).distance(50))
      .force('charge', forceManyBody().strength(-150))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide().radius(20))

    // ── Root group: receives zoom transform ──
    const g = svgSel.append('g')

    const linkGroup = g.append('g')
      .attr('stroke', '#333333')
      .attr('stroke-opacity', 0.6)

    const link = linkGroup
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke-width', (d: GraphLink) => Math.sqrt(d.value))

    const nodeGroup = g.append('g')

    const node = nodeGroup
      .selectAll('circle')
      .data(data.nodes)
      .join('circle')
      .attr('r', (d: GraphNode) => d.type === 'entity' ? Math.max(5, Math.min(20, Math.sqrt(d.tvl) / 10000)) : 3)
      .attr('fill', (d: GraphNode) => getColor(d.group))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .call(drag<SVGCircleElement, GraphNode>()
        .on('start', (event) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
        })
        .on('drag', (event) => {
          event.subject.fx = event.x
          event.subject.fy = event.y
        })
        .on('end', (event) => {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
        }) as any)

    node.append('title')
      .text((d: GraphNode) => `${d.label}\nType: ${d.type}\nTVL: $${(d.tvl / 1e6).toFixed(2)}M`)

    const labelGroup = g.append('g')
    const labels = labelGroup
      .selectAll('text')
      .data(data.nodes)
      .join('text')
      .text((d: GraphNode) => d.type === 'entity' && d.tvl > 1e8 ? d.label : '')
      .attr('font-size', '10px')
      .attr('fill', '#999')
      .attr('dx', 12)
      .attr('dy', 4)
      .attr('pointer-events', 'none')

    // ── Zoom behaviour ──
    const zoomBehaviour = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString())
        transformRef.current = event.transform
        setZoomLevel(Math.round(event.transform.k * 100) / 100)
      })

    zoomRef.current = zoomBehaviour

    svgSel
      .call(zoomBehaviour)
      .on('dblclick.zoom', null)

    // ── Simulation tick ──
    simulation.on('tick', () => {
      link
        .attr('x1', (d: GraphLink) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d: GraphLink) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d: GraphLink) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d: GraphLink) => (d.target as GraphNode).y ?? 0)

      node
        .attr('cx', (d: GraphNode) => d.x ?? 0)
        .attr('cy', (d: GraphNode) => d.y ?? 0)

      labels
        .attr('x', (d: GraphNode) => d.x ?? 0)
        .attr('y', (d: GraphNode) => d.y ?? 0)
    })

    // ── Search filter (called from React state) ──
    const applySearch = (q: string) => {
      const trimmed = q.trim().toLowerCase()

      if (!trimmed) {
        node.attr('opacity', 1).attr('stroke-width', 1.5)
        link.attr('opacity', 0.6)
        labels.attr('opacity', 1)
        highlightedRef.current = new Set()
        setHighlightedIds([])
        return
      }

      const matched = new Set<string>()
      data.nodes.forEach(n => {
        if (n.label.toLowerCase().includes(trimmed)) matched.add(n.id)
      })
      highlightedRef.current = matched
      setHighlightedIds(Array.from(matched))

      node
        .attr('opacity', (d: GraphNode) => matched.has(d.id) ? 1 : 0.08)
        .attr('stroke-width', (d: GraphNode) => matched.has(d.id) ? 3 : 1)

      link
        .attr('opacity', (d: GraphLink) => {
          const s = (d.source as GraphNode).id
          const t = (d.target as GraphNode).id
          return matched.has(s) || matched.has(t) ? 0.6 : 0.03
        })

      labels
        .attr('opacity', (d: GraphNode) => matched.has(d.id) ? 1 : 0.05)
    }

    // Store for React access
    ;(svgRef.current as unknown as Record<string, unknown>).__applySearch = applySearch

    // ── Zoom helpers (called from React) ──
    const applyZoom = (scaleFactor: number) => {
      const current = transformRef.current
      const nextK = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.k * scaleFactor))
      const next = current.scale(nextK / current.k)
      svgSel.transition().duration(300).call(zoomBehaviour.transform, next)
    }

    const applyReset = () => {
      svgSel.transition().duration(500).call(zoomBehaviour.transform, zoomIdentity)
    }

    ;(svgRef.current as unknown as Record<string, unknown>).__applyZoom = applyZoom
    ;(svgRef.current as unknown as Record<string, unknown>).__applyReset = applyReset

    return () => { simulation.stop() }
  }, [data])

  // ── Zoom-to-node (smooth pan+zoom) ──
  const zoomToNode = useCallback((nodeId: string) => {
    const svg = svgRef.current
    const zoomB = zoomRef.current
    if (!svg || !zoomB) return

    const target = data.nodes.find(n => n.id === nodeId)
    if (!target?.x || !target?.y) return

    const w = svg.clientWidth || 800
    const h = svg.clientHeight || 600
    const k = 3
    const tx = w / 2 - target.x * k
    const ty = h / 2 - target.y * k

    select(svg)
      .transition()
      .duration(750)
      .call(zoomB.transform, zoomIdentity.translate(tx, ty).scale(k))
  }, [data.nodes])

  // ── Keyboard shortcut: "/" to focus search ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return
        e.preventDefault()
        document.getElementById('graph-search-input')?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  const handleSearchChange = (value: string) => {
    setQuery(value)
    const fn = (svgRef.current as unknown as Record<string, ((q: string) => void) | undefined>).__applySearch
    fn?.(value)
  }

  const handleZoomIn = () => {
    const fn = (svgRef.current as unknown as Record<string, ((s: number) => void) | undefined>).__applyZoom
    fn?.(1.5)
  }

  const handleZoomOut = () => {
    const fn = (svgRef.current as unknown as Record<string, ((s: number) => void) | undefined>).__applyZoom
    fn?.(1 / 1.5)
  }

  const handleReset = () => {
    const fn = (svgRef.current as unknown as Record<string, (() => void) | undefined>).__applyReset
    fn?.()
    handleSearchChange('')
  }

  const handleNodeClick = (nodeId: string, nodeType: string) => {
    zoomToNode(nodeId)
    if (nodeType === 'entity') {
      window.location.href = `/entity/${nodeId}`
    } else if (nodeType === 'wallet') {
      window.location.href = `/wallet/${nodeId}`
    }
  }

  const matchCount = highlightedIds.length

  return (
    <div className="w-full h-full bg-bg-panel border border-bg-border rounded relative overflow-hidden min-h-[500px]">
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing absolute inset-0" />

      {/* ── Legend ── */}
      <div className="absolute top-4 left-4 bg-bg-base/80 p-3 border border-bg-border rounded backdrop-blur text-[10px] font-mono z-10">
        <h3 className="text-text-primary font-bold mb-2">Arkham Entity Graph</h3>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#00b8d9]"></span> Protocol</div>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#f39c12]"></span> Exchange</div>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#6554c0]"></span> Fund / VC</div>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#ff5630]"></span> Bridge</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#888888]"></span> Wallet Node</div>
      </div>

      {/* ── Search ── */}
      <div className="absolute top-4 right-4 z-20 w-64">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          <input
            id="graph-search-input"
            type="text"
            value={query}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search entities...  /"
            className="w-full bg-bg-base/90 border border-bg-border rounded pl-8 pr-8 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-teal-vivid/50 backdrop-blur"
          />
          {query && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-[10px]"
            >
              ✕
            </button>
          )}
        </div>

        {query && matchCount > 0 && (
          <div className="mt-1 bg-bg-base/95 border border-bg-border rounded max-h-48 overflow-y-auto scrollbar-thin backdrop-blur">
            {highlightedIds.slice(0, 20).map(id => {
              const n = data.nodes.find(nd => nd.id === id)
              if (!n) return null
              return (
                <button
                  key={id}
                  onClick={() => handleNodeClick(id, n.type)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-raised transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: ['#00b8d9','#f39c12','#6554c0','#ff5630','#36b37e','#888888'][n.group] ?? '#888888' }}
                  />
                  <span className="text-[10px] font-mono text-text-primary truncate">{n.label}</span>
                  <span className="text-[9px] font-mono text-text-muted ml-auto shrink-0">{n.type}</span>
                </button>
              )
            })}
            {matchCount > 20 && (
              <div className="px-3 py-1 text-[9px] text-text-muted font-mono border-t border-bg-border">
                +{matchCount - 20} more
              </div>
            )}
          </div>
        )}

        {query && matchCount === 0 && (
          <div className="mt-1 bg-bg-base/95 border border-bg-border rounded px-3 py-2 backdrop-blur">
            <span className="text-[10px] font-mono text-text-muted">No matches</span>
          </div>
        )}
      </div>

      {/* ── Zoom controls ── */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
        <button
          onClick={handleZoomIn}
          className="w-7 h-7 bg-bg-base/80 border border-bg-border rounded flex items-center justify-center text-text-muted hover:text-teal-vivid hover:border-teal-vivid/30 transition-colors text-[14px] font-mono backdrop-blur"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="w-7 h-7 bg-bg-base/80 border border-bg-border rounded flex items-center justify-center text-text-muted hover:text-teal-vivid hover:border-teal-vivid/30 transition-colors text-[14px] font-mono backdrop-blur"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={handleReset}
          className="w-7 h-7 bg-bg-base/80 border border-bg-border rounded flex items-center justify-center text-text-muted hover:text-teal-vivid hover:border-teal-vivid/30 transition-colors text-[10px] font-mono backdrop-blur"
          title="Reset view & clear search"
        >
          ⟲
        </button>
        <div className="text-center text-[9px] font-mono text-text-muted mt-0.5 tabular-nums">
          {Math.round(zoomLevel * 100)}%
        </div>
      </div>

      {/* ── Highlight count badge ── */}
      {query && matchCount > 0 && (
        <div className="absolute bottom-4 left-4 bg-teal-vivid/10 border border-teal-vivid/30 rounded px-2.5 py-1 text-[10px] font-mono text-teal-vivid z-10">
          {matchCount} match{matchCount !== 1 ? 'es' : ''}
        </div>
      )}
    </div>
  )
}
