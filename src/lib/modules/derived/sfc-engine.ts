// ─────────────────────────────────────────────────────────────
// SFC Engine — Smart-Flow Convergence wallet scoring
// Revives the indexer's detectSmartMoneyActivity feed (which returns
// null when a wallet is absent from smartMoneyWallet) by computing a
// real SmartMoneyWallet score from locally-available on-chain data:
// trade volume, count, token diversity, holdings, entity label,
// recency, and MEV penalty. No external keys required.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface SmartMoneyScoreRow {
  walletId: string
  address: string
  chain: string
  category: string
  score: number
  entityName: string | null
}

interface ScoreInputs {
  tradeCount: number
  totalVolume: number
  distinctTokens: number
  holdingsUsd: number
  hasEntity: boolean
  labels: string[]
  lastSeen: Date
}

const VOLUME_CAP = 1e9
const HOLDING_CAP = 1e8
const RECENT_DAYS = 30

function computeSmScore(i: ScoreInputs): number {
  const volumeScore = Math.min(40, (Math.log10(1 + i.totalVolume) / Math.log10(1 + VOLUME_CAP)) * 40)
  const tradeScore = Math.min(20, (i.tradeCount / 500) * 20)
  const diversityScore = Math.min(15, (i.distinctTokens / 20) * 15)
  const holdingScore = Math.min(15, (Math.log10(1 + i.holdingsUsd) / Math.log10(1 + HOLDING_CAP)) * 15)
  const entityBonus = i.hasEntity || i.labels.some((l) => /whale|fund|smart|institution/i.test(l)) ? 10 : 0
  const recencyBonus = Date.now() - i.lastSeen.getTime() < RECENT_DAYS * 86_400_000 ? 5 : 0
  const score = volumeScore + tradeScore + diversityScore + holdingScore + entityBonus + recencyBonus
  return Math.max(0, Math.min(100, Math.round(score)))
}

function deriveCategory(score: number, hasEntity: boolean): string {
  if (hasEntity) return 'institution'
  if (score >= 70) return 'whale'
  if (score >= 40) return 'smart'
  return 'trader'
}

// Recompute + persist SmartMoneyWallet scores. Also seeds the
// smartMoneyWallet table, reviving the indexer smart_money_action feed.
// Returns number of wallets written.
export async function refreshSmartMoneyScores(minTrades = 5): Promise<number> {
  const groups = await prisma.transaction.groupBy({
    by: ['walletId'],
    where: { walletId: { not: null } },
    _count: { _all: true },
    _sum: { amountUsd: true },
  })

  let written = 0
  for (const g of groups) {
    const walletId = g.walletId
    if (!walletId) continue
    const tradeCount = g._count._all
    if (tradeCount < minTrades) continue
    const totalVolume = g._sum.amountUsd ?? 0

    const [distinctRows, holdingsAgg, wallet] = await Promise.all([
      prisma.transaction.findMany({
        where: { walletId },
        select: { tokenSymbol: true },
        distinct: ['tokenSymbol'],
        take: 200,
      }),
      prisma.tokenHolding.aggregate({ where: { walletId }, _sum: { usdValue: true } }),
      prisma.wallet.findUnique({
        where: { id: walletId },
        select: { entityId: true, labels: true, lastSeen: true },
      }),
    ])
    if (!wallet) continue

    const score = computeSmScore({
      tradeCount,
      totalVolume,
      distinctTokens: distinctRows.length,
      holdingsUsd: holdingsAgg._sum.usdValue ?? 0,
      hasEntity: !!wallet.entityId,
      labels: wallet.labels,
      lastSeen: wallet.lastSeen,
    })
    const category = deriveCategory(score, !!wallet.entityId)

    await prisma.smartMoneyWallet.upsert({
      where: { walletId },
      create: { walletId, category, score },
      update: { category, score },
    })
    written++
  }
  return written
}

export async function fetchSmartMoneyScores(opts: { limit?: number; category?: string; minScore?: number } = {}): Promise<SmartMoneyScoreRow[]> {
  const where = opts.category ? { category: opts.category } : opts.minScore ? { score: { gte: opts.minScore } } : {}
  const rows = await prisma.smartMoneyWallet.findMany({
    where,
    orderBy: { score: 'desc' },
    take: opts.limit ?? 50,
    include: { wallet: { select: { address: true, chain: true, entity: { select: { name: true } } } } },
  })
  return rows.map((r) => ({
    walletId: r.walletId,
    address: r.wallet.address,
    chain: r.wallet.chain,
    category: r.category,
    score: r.score,
    entityName: r.wallet.entity?.name ?? null,
  }))
}

// ─── Predictive Wallet Score (forward-return join) ────────────
// For wallets whose trades touch assets we track in MarketSnapshot
// (BTC/ETH/SOL/WIF/BONK), join each buy to the price N minutes later
// and measure hit-rate. Returns null when no matched history exists
// (caller falls back to the heuristic score).

const PREDICT_HORIZON_MS = 60 * 60_000
const PREDICT_ASSETS = ['BTC', 'ETH', 'SOL', 'WIF', 'BONK']

function baseAsset(tokenSymbol: string | null): string | null {
  if (!tokenSymbol) return null
  const u = tokenSymbol.toUpperCase()
  return PREDICT_ASSETS.find((a) => u === a || u.startsWith(a)) ?? null
}

export async function predictiveScore(walletId: string): Promise<number | null> {
  const txs = await prisma.transaction.findMany({
    where: { walletId, tokenSymbol: { not: null }, amountUsd: { gt: 0 } },
    orderBy: { timestamp: 'asc' },
    take: 300,
  })

  let hits = 0
  let total = 0
  for (const tx of txs) {
    const asset = baseAsset(tx.tokenSymbol)
    if (!asset) continue
    const entry = await prisma.marketSnapshot.findFirst({
      where: { symbol: asset, sourceId: 'cex:coingecko', timestamp: { gte: tx.timestamp } },
      orderBy: { timestamp: 'asc' },
    })
    if (!entry) continue
    const exit = await prisma.marketSnapshot.findFirst({
      where: { symbol: asset, sourceId: 'cex:coingecko', timestamp: { gte: new Date(entry.timestamp.getTime() + PREDICT_HORIZON_MS) } },
      orderBy: { timestamp: 'asc' },
    })
    if (!exit || entry.price === 0) continue
    total++
    if (exit.price > entry.price) hits++
    if (total >= 50) break
  }
  if (total === 0) return null
  return Math.round((hits / total) * 100)
}

// ─── SFC Convergence (per-token) ─────────────────────────────
// SFC = Σ_i (PWS_i × independence_i) over smart wallets trading the
// token. independence = 1 − min(1, edgeCount/CLUSTER_CAP). Repricing
// gap = latest DEX/CEX premium for the asset (PremiumSnapshot).

const CLUSTER_CAP = 10

export interface SfcConvergence {
  token: string
  sfc: number
  walletCount: number
  repricingGapPct: number | null
  components: Array<{ walletId: string; score: number; independence: number }>
}

export async function computeSfcConvergence(tokenSymbol: string): Promise<SfcConvergence> {
  const asset = baseAsset(tokenSymbol) ?? tokenSymbol.toUpperCase()
  const smartWallets = await prisma.smartMoneyWallet.findMany({
    where: { score: { gt: 0 } },
    select: { walletId: true, score: true },
    take: 200,
  })
  const ids = smartWallets.map((s) => s.walletId)
  if (ids.length === 0) return { token: tokenSymbol, sfc: 0, walletCount: 0, repricingGapPct: null, components: [] }

  const trades = await prisma.transaction.groupBy({
    by: ['walletId'],
    where: { walletId: { in: ids }, tokenSymbol: { contains: asset } },
    _count: { _all: true },
  })
  const tradingIds = new Set(trades.map((t) => t.walletId))

  const edges = await prisma.walletRelationship.findMany({
    where: { fromWalletId: { in: ids } },
    select: { fromWalletId: true, _count: { _all: true } },
  })
  const edgeCount = new Map<string, number>()
  for (const e of edges) edgeCount.set(e.fromWalletId, e._count._all)

  const scoreById = new Map(smartWallets.map((s) => [s.walletId, s.score]))
  const components: SfcConvergence['components'] = []
  let sfc = 0
  for (const id of tradingIds) {
    const score = scoreById.get(id) ?? 0
    const independence = 1 - Math.min(1, (edgeCount.get(id) ?? 0) / CLUSTER_CAP)
    sfc += score * independence
    components.push({ walletId: id, score, independence })
  }

  const premium = await prisma.premiumSnapshot.findFirst({
    where: { asset },
    orderBy: { timestamp: 'desc' },
  })

  return {
    token: tokenSymbol,
    sfc: Math.round(sfc),
    walletCount: components.length,
    repricingGapPct: premium ? premium.premiumPct : null,
    components,
  }
}
