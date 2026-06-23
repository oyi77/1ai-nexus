// ─────────────────────────────────────────────────────────────
// GET /api/v1/entities/graph — Force-directed knowledge graph
// Returns nodes (entities + wallets) and links for D3 rendering
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

const GROUP_MAP: Record<string, number> = {
  protocol: 1,
  exchange: 2,
  fund: 3,
  bridge: 4,
  whale: 5,
  dao: 6,
}

export async function GET() {
  try {
    const entities = await prisma.entity.findMany({
      where: { totalUsdValue: { gt: 0 } },
      orderBy: { totalUsdValue: 'desc' },
      take: 200,
      include: { wallets: { select: { id: true, address: true } } },
    })

    const nodeSet = new Set<string>()
    const nodes: Array<{ id: string; group: number; label: string; tvl: number; type: string }> = []
    const links: Array<{ source: string; target: string; value: number }> = []

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

    // Synthetic inter-entity links (funds → protocols, protocols → exchanges)
    const byType = (t: string) => entities.filter(e => (e.type || '').toLowerCase() === t)
    const protocols = byType('protocol')
    const funds = [...byType('fund'), ...byType('dao')]
    const exchanges = byType('exchange')
    const bridges = byType('bridge')

    for (const f of funds) {
      const n = 2 + Math.floor(Math.random() * 3)
      for (let i = 0; i < n; i++) {
        const p = protocols[Math.floor(Math.random() * protocols.length)]
        if (p) links.push({ source: f.id, target: p.id, value: 5 })
      }
    }
    for (const p of protocols.slice(0, 30)) {
      const ex = exchanges[Math.floor(Math.random() * exchanges.length)]
      if (ex) links.push({ source: p.id, target: ex.id, value: 2 })
      const br = bridges[Math.floor(Math.random() * bridges.length)]
      if (br) links.push({ source: p.id, target: br.id, value: 3 })
    }

    const resp = NextResponse.json({ data: { nodes, links }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    return resp
  } catch (error) {
    console.error('Graph generation error:', error)
    return NextResponse.json(
      { data: null, error: 'Failed to generate entity graph' },
      { status: 500 },
    )
  }
}
