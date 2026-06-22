"use client";

import { useRef, useEffect } from "react";
import { select, type Selection, type BaseType } from 'd3-selection';
import { drag } from 'd3-drag';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum } from 'd3-force';
import { cn, getEntityTypeColor } from "@/lib/utils";

export interface ConnectedEntity {
  name: string;
  type: string;
  strength: number;
  volume: number;
}

interface ConnectedEntitiesGraphProps {
  centerName: string;
  connections: ConnectedEntity[];
  className?: string;
}

type NodeDatum = { id: string; group: string; radius: number; x?: number; y?: number; fx?: number | null; fy?: number | null } & SimulationNodeDatum;
type LinkDatum = { source: string | NodeDatum; target: string | NodeDatum; strength: number; volume: number };

export function ConnectedEntitiesGraph({ centerName, connections, className }: ConnectedEntitiesGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const currentSvg = svgRef.current;

    const svg = select(currentSvg);
    svg.selectAll("*").remove();

    const width = 600;
    const height = 400;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const nodes: NodeDatum[] = [
      { id: centerName, group: "center", radius: 28 },
      ...connections.map((c) => ({
        id: c.name,
        group: c.type,
        radius: 14 + c.strength * 14,
      })),
    ];

    const links: LinkDatum[] = connections.map((c) => ({
      source: centerName,
      target: c.name,
      strength: c.strength,
      volume: c.volume,
    }));

    const simulation = forceSimulation(nodes)
      .force("link", forceLink<NodeDatum, LinkDatum>(links).id((d) => d.id).distance(120))
      .force("charge", forceManyBody().strength(-300))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collision", forceCollide().radius(40));

    const link = svg
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#1A1D27")
      .attr("stroke-width", (d) => 1 + d.strength * 3)
      .attr("stroke-opacity", 0.6);

    const node = svg
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .call(
        drag<SVGGElement, NodeDatum>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }) as unknown as (sel: Selection<BaseType | SVGGElement, NodeDatum, SVGGElement, unknown>) => void
      );

    node
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => (d.group === "center" ? "#00D4FF" : getEntityTypeColor(d.group)))
      .attr("fill-opacity", 0.2)
      .attr("stroke", (d) => (d.group === "center" ? "#00D4FF" : getEntityTypeColor(d.group)))
      .attr("stroke-width", 1.5);

    node
      .append("text")
      .text((d) => d.id)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", "#E8EAED")
      .attr("font-size", (d) => (d.group === "center" ? 11 : 9))
      .attr("font-family", "var(--font-mono)")
      .style("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as NodeDatum).x ?? 0)
        .attr("y1", (d) => (d.source as NodeDatum).y ?? 0)
        .attr("x2", (d) => (d.target as NodeDatum).x ?? 0)
        .attr("y2", (d) => (d.target as NodeDatum).y ?? 0);

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [centerName, connections]);

  return (
    <div className={cn("rounded-lg border border-white/5 bg-bg-surface p-4", className)}>
      <svg ref={svgRef} className="h-full w-full" />
    </div>
  );
}
