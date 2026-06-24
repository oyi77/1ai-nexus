// ─────────────────────────────────────────────────────────────
// GET /api/v1/entities/graph — Force-directed knowledge graph
// Returns nodes (entities + wallets) and links for D3 rendering
// Server-side cached: 5min TTL (DB data doesn't change fast)
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'

const GROUP_MAP: Record<string, number> = {
  protocol: 1, exchange: 2, fund: 3, bridge: 4, whale: 5, dao: 6,
}

interface GraphNode {
  id: string
  group: number
  label: string
  tvl: number
  type: string
}

interface GraphLink {
  source: string
  target: string
  value: number
}

async function buildGraph() {
  const entities = await prisma.entity.findMany({
    where: { totalUsdValue: { gt: 0 } },
    orderBy: { totalUsdValue: 'desc' },
    take: 200,
    include: { wallets: { select: { id: true, address: true } } },
  })

  const nodeSet = new Set<string>()
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []

  for (const e of entities) {
    if (nodeSet.has(e.id)) continue
    nodeSet.add(e.id)
    nodes.push({
      id: e.id,
      group: GROUP_MAP[(e.type || '').toLowerCase()] ?? 0,
      label: e.name,
      tvl: e.totalUsdValue ?? 0,
      type: 'entity',
    })
    for (const w of e.wallets.slice(0, 3)) {
      if (nodeSet.has(w.id)) continue
      nodeSet.add(w.id)
      nodes.push({
        id: w.id,
        group: GROUP_MAP[(e.type || '').toLowerCase()] ?? 0,
        label: w.address.slice(0, 8) + '…',
        tvl: 0,
        type: 'wallet',
      })
      links.push({ source: e.id, target: w.id, value: 1 })
    }
  }

  // Deterministic inter-entity links based on shared chain proximity
  // Entities on the same chain get linked — no random data
  const byType = (t: string) => entities.filter(e => (e.type || '').toLowerCase() === t)
  const protocols = byType('protocol')
  const funds = [...byType('fund'), ...byType('dao')]
  const exchanges = byType('exchange')
  const bridges = byType('bridge')

  // Funds linked to protocols on the same chain
  for (const f of funds) {
    const fChains = (f.chains || []).map((c: string) => c.toLowerCase())
    const matching = protocols.filter(p => {
      const pChains = (p.chains || []).map((c: string) => c.toLowerCase())
      return pChains.some(pc => fChains.includes(pc))
    })
    for (const p of matching.slice(0, 3)) {
      links.push({ source: f.id, target: p.id, value: 5 })
    }
  }
  // Protocols linked to exchanges/bridges on the same chain
  for (const p of protocols.slice(0, 30)) {
    const pChains = (p.chains || []).map((c: string) => c.toLowerCase())
    const matchingEx = exchanges.filter(ex => {
      const exChains = (ex.chains || []).map((c: string) => c.toLowerCase())
      return exChains.some(ec => pChains.includes(ec))
    })
    if (matchingEx[0]) links.push({ source: p.id, target: matchingEx[0].id, value: 2 })
    const matchingBr = bridges.filter(br => {
      const brChains = (br.chains || []).map((c: string) => c.toLowerCase())
      return brChains.some(bc => pChains.includes(bc))
    })
    if (matchingBr[0]) links.push({ source: p.id, target: matchingBr[0].id, value: 3 })
  }

  return { nodes, links }
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('entities:graph', 300_000, buildGraph)
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Graph generation error:', error)
    return NextResponse.json({ data: null, error: 'Failed to generate entity graph' }, { status: 500 })
  }
}
