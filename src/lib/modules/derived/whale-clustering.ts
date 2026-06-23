// ─────────────────────────────────────────────────────────────
// Whale Wallet Clustering — identify connected wallets
// Combines known entity labels with DB entity data
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface WalletCluster {
  id: string
  wallets: string[]
  estimatedSize: number
  connectionMethod: string
  confidence: number
  label?: string
}

// Known high-value exchange/entity clusters (always included)
const KNOWN_CLUSTERS: Array<{ label: string; wallets: string[]; size: number }> = [
  { label: 'Binance', wallets: ['0x28C6c06298d514Db089934071355E5743bf21d60', '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549'], size: 5_000_000_000 },
  { label: 'Coinbase', wallets: ['0x71660c4005BA85c37ccec55d0C4493E66Fe775d3', '0x503828976D22510aad0201ac7EC88293211D23Da'], size: 3_000_000_000 },
  { label: 'Kraken', wallets: ['0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2'], size: 2_000_000_000 },
  { label: 'OKX', wallets: ['0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b'], size: 1_500_000_000 },
  { label: 'Jump Trading', wallets: ['0xf584F8728B874a6a5c7A8d4d387C9aae9172D621'], size: 800_000_000 },
  { label: 'Wintermute', wallets: ['0x0000006daea1723962647b7e189d311d757Fb793'], size: 500_000_000 },
]

let cachedClusters: WalletCluster[] = []
let lastFetch = 0
const CACHE_TTL = 5 * 60_000

/**
 * Detect wallet clusters from DB entities + known labels.
 */
export async function detectClusters(): Promise<WalletCluster[]> {
  const now = Date.now()
  if (cachedClusters.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedClusters
  }

  const clusters: WalletCluster[] = []

  // 1. Add known exchange clusters
  for (const kc of KNOWN_CLUSTERS) {
    clusters.push({
      id: `cluster-${kc.label.toLowerCase().replace(/\s/g, '-')}`,
      wallets: kc.wallets,
      estimatedSize: kc.size,
      connectionMethod: 'Known entity label',
      confidence: 0.95,
      label: kc.label,
    })
  }

  // 2. Fetch entities from DB
  try {
    const entities = await prisma.entity.findMany({
      include: { wallets: { select: { address: true, chain: true } } },
      orderBy: { totalUsdValue: 'desc' },
      take: 30,
    })

    for (const entity of entities) {
      // Skip if already in known clusters
      const labelLower = entity.name.toLowerCase()
      if (KNOWN_CLUSTERS.some(kc => kc.label.toLowerCase() === labelLower)) continue

      const wallets = entity.wallets.map(w => w.address)
      if (wallets.length === 0) continue

      clusters.push({
        id: `entity-${entity.id}`,
        wallets,
        estimatedSize: entity.totalUsdValue,
        connectionMethod: entity.type === 'exchange' ? 'Exchange entity' : entity.type === 'fund' ? 'Fund entity' : 'On-chain entity',
        confidence: entity.verified ? 0.9 : 0.7,
        label: entity.name,
      })
    }
  } catch (err) {
    console.error('[whale-clustering] DB fetch failed:', (err as Error).message)
  }

  // Sort by estimated size
  clusters.sort((a, b) => b.estimatedSize - a.estimatedSize)

  cachedClusters = clusters
  lastFetch = now
  return clusters
}

export function areWalletsConnected(_walletA: string, _walletB: string): { connected: boolean; confidence: number; method: string } {
  return { connected: false, confidence: 0, method: 'Insufficient data' }
}

export function getClusterById(id: string): WalletCluster | undefined {
  return cachedClusters.find(c => c.id === id)
}
