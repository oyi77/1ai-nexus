// ─────────────────────────────────────────────────────────────
// GET /api/v1/top-traders — Leaderboard from live transaction data
// Hyperdash/Nansen-style: ranks wallets by activity & volume
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'

interface TraderRow {
  address: string
  chain: string
  txCount: number
  totalVolume: number
  entityName: string | null
  entityType: string | null
  entityTvl: number
  smartMoneyScore: number
  lastActive: string
}

async function buildLeaderboard(): Promise<TraderRow[]> {
  // Get top wallets by transaction count from live indexer data
  const txStats = await prisma.transaction.groupBy({
    by: ['from'],
    where: { from: { not: null } },
    _count: { txHash: true },
    _sum: { amountUsd: true },
    orderBy: { _count: { txHash: 'desc' } },
    take: 50,
  })

  // Get entity info for these wallets
  const addresses = txStats.map(t => t.from).filter((a): a is string => a !== null)
  const wallets = await prisma.wallet.findMany({
    where: { address: { in: addresses, mode: 'insensitive' } },
    include: {
      entity: { select: { name: true, type: true, totalUsdValue: true } },
      smartMoneyWallet: { select: { score: true } },
    },
  })

  const walletMap = new Map(wallets.map(w => [w.address.toLowerCase(), w]))

  return txStats
    .filter((t): t is typeof t & { from: string } => t.from !== null)
    .map(t => {
      const wallet = walletMap.get(t.from.toLowerCase())
      return {
        address: t.from,
        chain: wallet?.chain ?? 'ethereum',
        txCount: t._count.txHash,
        totalVolume: t._sum.amountUsd ?? 0,
        entityName: wallet?.entity?.name ?? null,
        entityType: wallet?.entity?.type ?? null,
        entityTvl: wallet?.entity?.totalUsdValue ?? 0,
        smartMoneyScore: wallet?.smartMoneyWallet?.score ?? 0,
        lastActive: new Date().toISOString(),
      }
    })
    .sort((a, b) => b.txCount - a.txCount)
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('top-traders', 30_000, buildLeaderboard)
    const resp = NextResponse.json({ data: { traders: data, count: data.length }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Top traders error:', error)
    return NextResponse.json({ data: null, error: 'Failed to build leaderboard' }, { status: 502 })
  }
}