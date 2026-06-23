// ─────────────────────────────────────────────────────────────
// Fresh Wallet Insider Detector
// Detects wallets with <10 txs that suddenly move >$100K
// Classic insider/whale accumulation pattern
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface InsiderSignal {
  id: string
  walletAddress: string
  chain: string
  totalTxs: number
  walletAge: string
  firstSeen: string
  largeTxAmount: number
  largeTxToken: string
  riskScore: number // 0-100
  suspicionReasons: string[]
  detectedAt: Date
}

interface InsiderConfig {
  maxTxCount: number // Fresh wallet = fewer than this many txs
  minAmountUsd: number // Large tx = above this amount
  walletAgeDays: number // Fresh = created within this many days
}

const DEFAULT_CONFIG: InsiderConfig = {
  maxTxCount: 20,
  minAmountUsd: 100_000,
  walletAgeDays: 30,
}

// Cache
let cachedSignals: InsiderSignal[] = []
let lastScan = 0
const SCAN_INTERVAL = 5 * 60 * 1000 // 5 minutes

/**
 * Calculate risk score for a fresh wallet making a large tx.
 * Higher = more suspicious.
 */
function calculateRiskScore(tx: {
  amountUsd: number
  txCount: number
  walletAgeHours: number
  tokenSymbol: string
}): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Amount factor: bigger = more suspicious
  if (tx.amountUsd > 1_000_000) {
    score += 40
    reasons.push(`$${(tx.amountUsd / 1e6).toFixed(1)}M transaction from near-empty wallet`)
  } else if (tx.amountUsd > 500_000) {
    score += 30
    reasons.push(`$${(tx.amountUsd / 1e3).toFixed(0)}K transaction from near-empty wallet`)
  } else if (tx.amountUsd > 100_000) {
    score += 20
    reasons.push(`$${(tx.amountUsd / 1e3).toFixed(0)}K transaction from fresh wallet`)
  }

  // Freshness factor: newer = more suspicious
  if (tx.txCount <= 2) {
    score += 30
    reasons.push(`Only ${tx.txCount} prior transactions — brand new wallet`)
  } else if (tx.txCount <= 5) {
    score += 20
    reasons.push(`Only ${tx.txCount} prior transactions — very fresh`)
  } else if (tx.txCount <= 10) {
    score += 10
    reasons.push(`${tx.txCount} prior transactions — relatively new`)
  }

  // Age factor: younger = more suspicious
  if (tx.walletAgeHours < 24) {
    score += 25
    reasons.push('Wallet created less than 24 hours ago')
  } else if (tx.walletAgeHours < 72) {
    score += 15
    reasons.push('Wallet created less than 3 days ago')
  } else if (tx.walletAgeHours < 168) {
    score += 5
    reasons.push('Wallet created less than 1 week ago')
  }

  // Token factor: stablecoins often used for insider positioning
  const stablecoins = ['USDT', 'USDC', 'DAI', 'FDUSD', 'USDe']
  if (stablecoins.includes(tx.tokenSymbol)) {
    score += 5
    reasons.push('Stablecoin movement — possible positioning for buy')
  }

  return { score: Math.min(100, score), reasons }
}

/**
 * Scan database for fresh wallets with large recent transactions.
 */
export async function scanForInsiderSignals(): Promise<InsiderSignal[]> {
  const now = Date.now()
  if (cachedSignals.length > 0 && now - lastScan < SCAN_INTERVAL) {
    return cachedSignals
  }

  const signals: InsiderSignal[] = []

  try {
    // Find transactions with large values
    const largeTxs = await prisma.transaction.findMany({
      where: {
        value: { gte: DEFAULT_CONFIG.minAmountUsd },
      },
      include: { wallet: true },
      orderBy: { timestamp: 'desc' },
      take: 200,
    })

    for (const tx of largeTxs) {
      // Count total transactions for this wallet
      const txCount = await prisma.transaction.count({
        where: { walletId: tx.walletId },
      })

      // Skip wallets with many transactions (not fresh)
      if (txCount > DEFAULT_CONFIG.maxTxCount) continue

      // Calculate wallet age
      const walletCreatedAt = tx.wallet?.createdAt || tx.timestamp
      const walletAgeMs = now - new Date(walletCreatedAt).getTime()
      const walletAgeHours = walletAgeMs / (1000 * 60 * 60)
      const walletAgeDays = walletAgeHours / 24

      // Skip old wallets
      if (walletAgeDays > DEFAULT_CONFIG.walletAgeDays) continue

      // Calculate risk
      const { score, reasons } = calculateRiskScore({
        amountUsd: tx.value,
        txCount,
        walletAgeHours,
        tokenSymbol: tx.wallet?.labels?.[0] || 'UNKNOWN',
      })

      // Only include signals above threshold
      if (score < 30) continue

      const ageStr = walletAgeDays < 1
        ? `${Math.round(walletAgeHours)}h`
        : walletAgeDays < 7
        ? `${Math.round(walletAgeDays)}d`
        : `${Math.round(walletAgeDays / 7)}w`

      signals.push({
        id: `insider-${tx.id}`,
        walletAddress: tx.wallet?.address || tx.txHash,
        chain: tx.wallet?.chain || 'unknown',
        totalTxs: txCount,
        walletAge: ageStr,
        firstSeen: new Date(walletCreatedAt).toISOString(),
        largeTxAmount: tx.value,
        largeTxToken: tx.wallet?.labels?.[0] || 'UNKNOWN',
        riskScore: score,
        suspicionReasons: reasons,
        detectedAt: tx.timestamp,
      })
    }

    // Sort by risk score descending
    signals.sort((a, b) => b.riskScore - a.riskScore)

    cachedSignals = signals.slice(0, 50) // Top 50
    lastScan = now
  } catch (err) {
    console.error('[InsiderDetector] Scan failed:', (err as Error).message)
  }

  return cachedSignals
}

export function getCachedInsiderSignals(): InsiderSignal[] {
  return cachedSignals
}
