"use client"

import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type Simulation } from 'd3-force'
import { drag } from 'd3-drag'

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

export function EntityGraph({ data }: { data: GraphData }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return

    const width = svgRef.current.clientWidth || 800
    const height = svgRef.current.clientHeight || 600

    select(svgRef.current).selectAll('*').remove()

    const svg = select(svgRef.current)
      .attr('viewBox', [0, 0, width, height] as unknown as string)

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

    const link = svg.append('g')
      .attr('stroke', '#333333')
      .attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke-width', (d: GraphLink) => Math.sqrt(d.value))

    const node = svg.append('g')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .selectAll('circle')
      .data(data.nodes)
      .join('circle')
      .attr('r', (d: GraphNode) => d.type === 'entity' ? Math.max(5, Math.min(20, Math.sqrt(d.tvl) / 10000)) : 3)
      .attr('fill', (d: GraphNode) => getColor(d.group))
      .call(drag<SVGCircleElement, GraphNode>()
        .on('start', (event: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
        })
        .on('drag', (event: any) => {
          event.subject.fx = event.x
          event.subject.fy = event.y
        })
        .on('end', (event: any) => {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
        }) as any)

    node.append('title')
      .text((d: GraphNode) => `${d.label}\nTVL: $${(d.tvl / 1e6).toFixed(2)}M`)

    const labels = svg.append('g')
      .selectAll('text')
      .data(data.nodes)
      .join('text')
      .text((d: GraphNode) => d.type === 'entity' && d.tvl > 1e8 ? d.label : '')
      .attr('font-size', '10px')
      .attr('fill', '#999')
      .attr('dx', 12)
      .attr('dy', 4)

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

    return () => {
      simulation.stop()
    }
  }, [data])

  return (
    <div className="w-full h-full bg-bg-panel border border-bg-border rounded relative overflow-hidden min-h-[500px]">
      <svg ref={svgRef} className="w-full h-full cursor-move absolute inset-0" />
      <div className="absolute top-4 left-4 bg-bg-base/80 p-3 border border-bg-border rounded backdrop-blur text-[10px] font-mono">
        <h3 className="text-text-primary font-bold mb-2">Arkham Entity Graph</h3>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#00b8d9]"></span> Protocol</div>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#f39c12]"></span> Exchange</div>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#6554c0]"></span> Fund / VC</div>
        <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-[#ff5630]"></span> Bridge</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#888888]"></span> Wallet Node</div>
      </div>
    </div>
  )
}
