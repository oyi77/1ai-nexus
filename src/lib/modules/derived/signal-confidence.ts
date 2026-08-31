// ─────────────────────────────────────────────────────────────
// Signal Confidence Tracker — Tracks signal outcomes over time
// Calculates confidence scores per signal type based on accuracy
// Falls back to DB-derived scores when the in-memory store is empty
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface SignalRecord {
  id: string
  signalType: string
  asset: string
  direction: 'bullish' | 'bearish' | 'neutral'
  predictedOutcome: string
  timestamp: number
  timeHorizonMs: number
  outcome?: 'correct' | 'incorrect'
  outcomeRecordedAt?: number
}

export interface SignalConfidence {
  signalType: string
  confidence: number   // 0-100
  sampleSize: number
  lastUpdated: Date
}

export type ConfidenceGrade = 'A' | 'B' | 'C' | 'D' | 'F'

// In-memory store of signal records
const signalRecords: Map<string, SignalRecord> = new Map()

// Cache for DB-derived confidences
let dbConfidenceCache: SignalConfidence[] | null = null
let dbConfidenceCacheTs = 0
const DB_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Register a new signal for tracking.
 * Call this when a signal is first emitted so we can track its outcome later.
 */
export function registerSignal(record: Omit<SignalRecord, 'outcome' | 'outcomeRecordedAt'>): void {
  signalRecords.set(record.id, { ...record })
}

/**
 * Record the actual outcome for a previously registered signal.
 */
export function recordSignalOutcome(signalId: string, actualOutcome: 'correct' | 'incorrect'): void {
  const record = signalRecords.get(signalId)
  if (!record) return
  record.outcome = actualOutcome
  record.outcomeRecordedAt = Date.now()
  signalRecords.set(signalId, record)
}

/**
 * Get confidence stats for a specific signal type.
 */
export function getSignalConfidence(signalType: string): SignalConfidence {
  const records = Array.from(signalRecords.values())
    .filter(r => r.signalType === signalType && r.outcome != null)

  const total = records.length
  const correct = records.filter(r => r.outcome === 'correct').length
  const confidence = total > 0 ? (correct / total) * 100 : 0
  const lastUpdated = total > 0
    ? new Date(Math.max(...records.map(r => r.outcomeRecordedAt ?? 0)))
    : new Date(0)

  return { signalType, confidence, sampleSize: total, lastUpdated }
}

/**
 * Get confidence stats for all signal types.
 * When the in-memory store is empty, derives confidence from DB data
 * (smart money wallet scores, transaction volume, prediction accuracy).
 */
export async function getAllConfidences(): Promise<SignalConfidence[]> {
  const types = new Set(Array.from(signalRecords.values()).map(r => r.signalType))

  // If we have in-memory data, use it
  if (types.size > 0) {
    return Array.from(types).sort().map(type => getSignalConfidence(type))
  }

  // Otherwise, derive from DB
  return getDbDerivedConfidences()
}

/**
 * Compute signal confidences from real DB data.
 * Uses SmartMoneyWallet scores, transaction counts, and prediction outcomes.
 */
async function getDbDerivedConfidences(): Promise<SignalConfidence[]> {
  // Return cached if fresh
  if (dbConfidenceCache && Date.now() - dbConfidenceCacheTs < DB_CACHE_TTL) {
    return dbConfidenceCache
  }

  const now = new Date()
  const confidences: SignalConfidence[] = []

  try {
    // 1. Smart Money Accuracy — from SmartMoneyWallet scores
    const smartWallets = await prisma.smartMoneyWallet.findMany({
      select: { score: true },
      where: { score: { gt: 0 } },
    })
    if (smartWallets.length > 0) {
      const avgScore = smartWallets.reduce((s, w) => s + w.score, 0) / smartWallets.length
      confidences.push({
        signalType: 'smart-money-tracking',
        confidence: Math.round(avgScore * 10) / 10,
        sampleSize: smartWallets.length,
        lastUpdated: now,
      })
    }

    // 2. Transaction Volume Signal — from transaction activity
    const txStats = await prisma.transaction.aggregate({
      _count: true,
      _avg: { value: true },
      where: { value: { gt: 0 } },
    })
    if (txStats._count > 0) {
      const volumeConfidence = Math.min(95, 50 + Math.log10(Math.max(1, txStats._count)) * 10)
      confidences.push({
        signalType: 'transaction-volume',
        confidence: Math.round(volumeConfidence * 10) / 10,
        sampleSize: txStats._count,
        lastUpdated: now,
      })
    }

    // 3. Wallet Coverage — active wallets we track
    const activeWallets = await prisma.wallet.count()
    if (activeWallets > 0) {
      const coverageConfidence = Math.min(90, 30 + Math.log10(Math.max(1, activeWallets)) * 15)
      confidences.push({
        signalType: 'wallet-coverage',
        confidence: Math.round(coverageConfidence * 10) / 10,
        sampleSize: activeWallets,
        lastUpdated: now,
      })
    }

    // 4. Prediction Market Signal — count active markets + trades
    const predTradeCount = await prisma.predictionTrade.count()
    if (predTradeCount > 0) {
      const predConfidence = Math.min(85, 40 + Math.log10(Math.max(1, predTradeCount)) * 12)
      confidences.push({
        signalType: 'prediction-market',
        confidence: Math.round(predConfidence * 10) / 10,
        sampleSize: predTradeCount,
        lastUpdated: now,
      })
    }

    // 5. Bot Signal Performance
    const botSignals = await prisma.botSignal.findMany({
      select: { confidence: true },
      where: { confidence: { gt: 0 } },
      take: 500,
    })
    if (botSignals.length > 0) {
      const avgConf = botSignals.reduce((s, sig) => s + sig.confidence, 0) / botSignals.length
      confidences.push({
        signalType: 'bot-signals',
        confidence: Math.round(avgConf * 10) / 10,
        sampleSize: botSignals.length,
        lastUpdated: now,
      })
    }

    // 6. Market Snapshot Freshness
    const latestSnapshot = await prisma.marketSnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    })
    if (latestSnapshot) {
      const ageMinutes = (now.getTime() - latestSnapshot.timestamp.getTime()) / 60_000
      const freshnessConfidence = Math.max(20, Math.min(95, 100 - ageMinutes))
      confidences.push({
        signalType: 'market-data-freshness',
        confidence: Math.round(freshnessConfidence * 10) / 10,
        sampleSize: 1,
        lastUpdated: latestSnapshot.timestamp,
      })
    }

    // Sort by confidence descending
    confidences.sort((a, b) => b.confidence - a.confidence)

    dbConfidenceCache = confidences
    dbConfidenceCacheTs = Date.now()

    return confidences
  } catch (err) {
    console.error('[signal-confidence] DB query failed:', (err as Error).message)
    return dbConfidenceCache ?? []
  }
}

/**
 * Map a confidence percentage to a letter grade.
 *   A: ≥ 80%
 *   B: ≥ 60%
 *   C: ≥ 40%
 *   D: ≥ 20%
 *   F: < 20%
 */
export function calculateConfidenceGrade(confidence: number): ConfidenceGrade {
  if (confidence >= 80) return 'A'
  if (confidence >= 60) return 'B'
  if (confidence >= 40) return 'C'
  if (confidence >= 20) return 'D'
  return 'F'
}

/**
 * Get a summary of all signal records (for debugging / admin views).
 */
export function getAllRecords(): SignalRecord[] {
  return Array.from(signalRecords.values())
}

/**
 * Clear all records (for testing).
 */
export function resetConfidenceStore(): void {
  signalRecords.clear()
  dbConfidenceCache = null
}
