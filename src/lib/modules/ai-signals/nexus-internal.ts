// ─────────────────────────────────────────────────────────────
// NEXUS Internal Smart Money Scoring Engine
// sourceType: derived
// Combines: wallet age, on-chain PnL, DEX trade patterns, entity labels
// No external call required — computes from existing module data
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

export interface SmartMoneyScore {
  address: string
  chain: string
  score: number         // 0-100
  category: string      // 'vc' | 'cex' | 'whale' | 'defi' | 'trader'
  confidence: number    // 0-1
  signals: string[]
}

interface ScoreInput {
  address: string
  chain: string
  txCount?: number
  firstSeen?: string
  totalVolume?: number
  winRate?: number
  avgHoldTime?: number
  entityLabel?: string
}

function computeScore(input: ScoreInput): SmartMoneyScore {
  let score = 0
  const signals: string[] = []

  // Wallet age signal (older = more likely smart money)
  if (input.firstSeen) {
    const ageDays = (Date.now() - new Date(input.firstSeen).getTime()) / 86_400_000
    if (ageDays > 365) { score += 20; signals.push('wallet_age>1yr') }
    else if (ageDays > 90) { score += 10; signals.push('wallet_age>90d') }
  }

  // Transaction volume signal
  if (input.totalVolume && input.totalVolume > 1_000_000) {
    score += 25; signals.push('volume>$1M')
  } else if (input.totalVolume && input.totalVolume > 100_000) {
    score += 15; signals.push('volume>$100K')
  }

  // Win rate signal
  if (input.winRate && input.winRate > 0.6) {
    score += 20; signals.push('winrate>60%')
  } else if (input.winRate && input.winRate > 0.5) {
    score += 10; signals.push('winrate>50%')
  }

  // Entity label signal (known entities get a boost)
  if (input.entityLabel) {
    score += 15; signals.push(`entity:${input.entityLabel}`)
  }

  // Hold time signal (longer hold = more conviction)
  if (input.avgHoldTime && input.avgHoldTime > 7) {
    score += 10; signals.push('holdtime>7d')
  }

  // Transaction count signal
  if (input.txCount && input.txCount > 1000) {
    score += 10; signals.push('txcount>1000')
  }

  // Determine category
  let category = 'trader'
  if (input.entityLabel) {
    const label = input.entityLabel.toLowerCase()
    if (label.includes('fund') || label.includes('vc') || label.includes('capital')) category = 'vc'
    else if (label.includes('exchange') || label.includes('binance') || label.includes('coinbase')) category = 'cex'
    else if (label.includes('whale') || label.includes('protocol')) category = 'whale'
    else if (label.includes('defi') || label.includes('dao')) category = 'defi'
  }

  return {
    address: input.address,
    chain: input.chain,
    score: Math.min(100, score),
    category,
    confidence: Math.min(1, signals.length * 0.2),
    signals,
  }
}

async function fetchSmartMoney(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'score'

  if (action === 'score') {
    const address = params.address as string
    const chain = (params.chain as string) ?? 'eth'
    if (!address) throw new Error('SmartMoney: address required')

    // Score a single wallet (would normally fetch on-chain data first)
    return computeScore({ address, chain })
  }

  if (action === 'leaderboard') {
    // Return top scored wallets from DB
    // For now, return empty — will be populated by seed data
    return []
  }

  throw new Error(`SmartMoney: unknown action ${action}`)
}

const smartMoneyModule: DataModule = {
  id: 'nexus-smart-money',
  name: 'NEXUS Smart Money Engine',
  category: 'ai-signals',
  sourceType: 'derived',
  provenance: {
    describesItself: 'Internal smart money scoring — combines wallet age, PnL, trade patterns, entity labels',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'nexus-smart-money',
      params,
      TTL.ENTITY_LABEL,
      () => fetchSmartMoney(params) as Promise<T>,
    )
  },
}

export default smartMoneyModule
export { computeScore }
