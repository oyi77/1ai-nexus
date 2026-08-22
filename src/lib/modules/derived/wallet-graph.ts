// ─────────────────────────────────────────────────────────────
// Wallet Relationship Graph
// Derives funding/transfer edges between known wallets from
// Transaction (from/to address → wallet id). Replaces the
// areWalletsConnected() stub in whale-clustering.ts with a real
// DB-backed lookup. No external keys.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

// Derive WalletRelationship edges from transactions where both
// counterparties are known wallet addresses. Returns edges written.
export async function refreshWalletRelationships(): Promise<number> {
  const addressToId = new Map<string, string>()
  const wallets = await prisma.wallet.findMany({ select: { id: true, address: true } })
  for (const w of wallets) addressToId.set(w.address.toLowerCase(), w.id)

  const txs = await prisma.transaction.findMany({
    where: { from: { not: null }, to: { not: null }, walletId: { not: null } },
    select: { from: true, to: true, amountUsd: true, timestamp: true },
    take: 20_000,
    orderBy: { timestamp: 'desc' },
  })

  const edgeMap = new Map<string, { from: string; to: string; count: number; usd: number; first: Date; last: Date }>()
  for (const t of txs) {
    const from = t.from!.toLowerCase()
    const to = t.to!.toLowerCase()
    const fromId = addressToId.get(from)
    const toId = addressToId.get(to)
    if (!fromId || !toId || fromId === toId) continue
    const key = `${fromId}|${toId}`
    const prev = edgeMap.get(key)
    if (prev) {
      prev.count++
      prev.usd += t.amountUsd
      if (t.timestamp < prev.first) prev.first = t.timestamp
      if (t.timestamp > prev.last) prev.last = t.timestamp
    } else {
      edgeMap.set(key, { from: fromId, to: toId, count: 1, usd: t.amountUsd, first: t.timestamp, last: t.timestamp })
    }
  }

  let written = 0
  for (const e of edgeMap.values()) {
    try {
      await prisma.walletRelationship.upsert({
        where: { fromWalletId_toWalletId_relationshipType: { fromWalletId: e.from, toWalletId: e.to, relationshipType: 'funds' } },
        create: { fromWalletId: e.from, toWalletId: e.to, relationshipType: 'funds', txCount: e.count, totalUsd: e.usd, firstSeen: e.first, lastSeen: e.last },
        update: { txCount: e.count, totalUsd: e.usd, lastSeen: e.last },
      })
      written++
    } catch {
      /* skip */
    }
  }
  return written
}

export interface ConnectionResult {
  connected: boolean
  confidence: number
  method: string
}

// Real lookup: direct edge, either direction, or shared cluster.
export async function areWalletsConnectedReal(walletA: string, walletB: string): Promise<ConnectionResult> {
  if (walletA === walletB) return { connected: true, confidence: 1, method: 'self' }

  const edge = await prisma.walletRelationship.findFirst({
    where: {
      OR: [
        { fromWalletId: walletA, toWalletId: walletB },
        { fromWalletId: walletB, toWalletId: walletA },
      ],
    },
    orderBy: { totalUsd: 'desc' },
  })
  if (edge) {
    const conf = Math.min(1, edge.txCount / 10 + Math.min(0.5, edge.totalUsd / 1e6))
    return { connected: true, confidence: conf, method: `funding_edge(${edge.relationshipType})` }
  }

  const [a, b] = await Promise.all([
    prisma.wallet.findUnique({ where: { id: walletA }, select: { entityId: true } }),
    prisma.wallet.findUnique({ where: { id: walletB }, select: { entityId: true } }),
  ])
  if (a?.entityId && a.entityId === b?.entityId) {
    return { connected: true, confidence: 0.6, method: 'shared_entity' }
  }
  return { connected: false, confidence: 0, method: 'No edge found' }
}
