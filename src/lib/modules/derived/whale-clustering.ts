// ─────────────────────────────────────────────────────────────
// Whale Wallet Clustering — identify connected wallets
// Uses DB entity data only (no hardcoded addresses)
// Enriched with holdings, risk scores, chain distribution
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { areWalletsConnectedReal } from './wallet-graph'

export interface ClusterWallet {
  address: string
  chain: string
  labels: string[]
  riskScore: number
  lastSeen: string
  holdingCount: number
  topHolding?: { symbol: string; usdValue: number }
}

export interface WalletCluster {
  id: string
  label: string
  type: string
  verified: boolean
  logoUrl?: string
  wallets: ClusterWallet[]
  walletCount: number
  estimatedSize: number
  change1d: number
  chains: string[]
  connectionMethod: string
  confidence: number
  avgRiskScore: number
  recentTxCount: number
  lastActivity: string
  topTokens: { symbol: string; usdValue: number }[]
}

export interface ClusterSummary {
  totalClusters: number
  totalAum: number
  avgConfidence: number
  verifiedCount: number
  typeBreakdown: Record<string, number>
  chainBreakdown: Record<string, number>
}

export interface ClusterPayload {
  summary: ClusterSummary
  clusters: WalletCluster[]
}

let cachedPayload: ClusterPayload | null = null
let lastFetch = 0
const CACHE_TTL = 5 * 60_000

/**
 * Detect wallet clusters from DB entities with enriched data.
 */
export async function detectClusters(): Promise<ClusterPayload> {
  const now = Date.now()
  if (cachedPayload && now - lastFetch < CACHE_TTL) {
    return cachedPayload
  }

  const clusters: WalletCluster[] = []

  try {
    const entities = await prisma.entity.findMany({
      include: {
        wallets: {
          select: {
            address: true,
            chain: true,
            labels: true,
            riskScore: true,
            lastSeen: true,
            holdings: {
              select: {
                usdValue: true,
                token: { select: { symbol: true } },
              },
              orderBy: { usdValue: 'desc' },
              take: 3,
            },
            transactions: {
              select: { id: true },
              where: {
                timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
              },
            },
          },
        },
      },
      orderBy: { totalUsdValue: 'desc' },
      take: 50,
    })

    for (const entity of entities) {
      if (entity.wallets.length === 0) continue

      const clusterWallets: ClusterWallet[] = entity.wallets.map(w => ({
        address: w.address,
        chain: w.chain,
        labels: w.labels,
        riskScore: w.riskScore,
        lastSeen: w.lastSeen.toISOString(),
        holdingCount: w.holdings.length,
        topHolding: w.holdings[0]
          ? { symbol: w.holdings[0].token.symbol, usdValue: w.holdings[0].usdValue }
          : undefined,
      }))

      const avgRisk = entity.wallets.reduce((s, w) => s + w.riskScore, 0) / entity.wallets.length
      const totalTx7d = entity.wallets.reduce((s, w) => s + w.transactions.length, 0)
      const latestSeen = entity.wallets.reduce((latest, w) => {
        const d = new Date(w.lastSeen)
        return d > latest ? d : latest
      }, new Date(0))

      // Aggregate top tokens across all wallets
      const tokenMap = new Map<string, number>()
      for (const w of entity.wallets) {
        for (const h of w.holdings) {
          const sym = h.token.symbol
          tokenMap.set(sym, (tokenMap.get(sym) ?? 0) + h.usdValue)
        }
      }
      const topTokens = [...tokenMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([symbol, usdValue]) => ({ symbol, usdValue }))

      const chainSet = new Set(entity.wallets.map(w => w.chain))

      clusters.push({
        id: `entity-${entity.id}`,
        label: entity.name,
        type: entity.type,
        verified: entity.verified,
        logoUrl: entity.logoUrl ?? undefined,
        wallets: clusterWallets,
        walletCount: entity.wallets.length,
        estimatedSize: entity.totalUsdValue,
        change1d: entity.change1d,
        chains: [...chainSet],
        connectionMethod: entity.type === 'exchange' ? 'Exchange entity'
          : entity.type === 'fund' ? 'Fund entity'
          : entity.type === 'protocol' ? 'Protocol entity'
          : 'On-chain entity',
        confidence: entity.verified ? 0.95 : entity.wallets.length > 3 ? 0.8 : 0.65,
        avgRiskScore: Math.round(avgRisk),
        recentTxCount: totalTx7d,
        lastActivity: latestSeen.toISOString(),
        topTokens,
      })
    }
  } catch (err) {
    console.error('[whale-clustering] DB fetch failed:', (err as Error).message)
  }

  clusters.sort((a, b) => b.estimatedSize - a.estimatedSize)

  // Build summary
  const typeBreakdown: Record<string, number> = {}
  const chainBreakdown: Record<string, number> = {}
  let totalAum = 0
  let totalConfidence = 0
  let verifiedCount = 0

  for (const c of clusters) {
    totalAum += c.estimatedSize
    totalConfidence += c.confidence
    if (c.verified) verifiedCount++
    typeBreakdown[c.type] = (typeBreakdown[c.type] ?? 0) + 1
    for (const ch of c.chains) {
      chainBreakdown[ch] = (chainBreakdown[ch] ?? 0) + 1
    }
  }

  const payload: ClusterPayload = {
    summary: {
      totalClusters: clusters.length,
      totalAum,
      avgConfidence: clusters.length > 0 ? totalConfidence / clusters.length : 0,
      verifiedCount,
      typeBreakdown,
      chainBreakdown,
    },
    clusters,
  }

  cachedPayload = payload
  lastFetch = now
  return payload
}

export async function areWalletsConnected(walletA: string, walletB: string): Promise<{ connected: boolean; confidence: number; method: string }> {
  // Inputs may be wallet ids or addresses; resolve to ids.
  const resolve = async (v: string) => {
    const byId = await prisma.wallet.findUnique({ where: { id: v }, select: { id: true } })
    if (byId) return byId.id
    const byAddr = await prisma.wallet.findFirst({ where: { address: v }, select: { id: true } })
    return byAddr?.id ?? v
  }
  const [a, b] = await Promise.all([resolve(walletA), resolve(walletB)])
  return areWalletsConnectedReal(a, b)
}

export function getClusterById(id: string): WalletCluster | undefined {
  return cachedPayload?.clusters.find(c => c.id === id)
}
