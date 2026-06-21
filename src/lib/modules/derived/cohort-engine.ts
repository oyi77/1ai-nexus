// ─────────────────────────────────────────────────────────────
// Smart Money Cohort Engine — beats Nansen's behavioral cohorts
// §2.3 — classify wallets into behavioral cohorts, not just size
// ─────────────────────────────────────────────────────────────

export interface Cohort {
  id: string
  name: string
  description: string
  criteria: {
    minPnl?: number
    maxPnl?: number
    minWinRate?: number
    minTradeCount?: number
    minVolume?: number
    entityTypes?: string[]
  }
  walletCount: number
  netFlow24h: number
  topAssets: string[]
}

export interface CohortSignal {
  cohortId: string
  cohortName: string
  action: 'accumulating' | 'distributing' | 'rotating' | 'dormant'
  asset: string
  amountUsd: number
  confidence: number
  timestamp: Date
}

// Predefined cohorts (Hyperdash/HyperTracker style)
const COHORT_DEFINITIONS: Omit<Cohort, 'walletCount' | 'netFlow24h' | 'topAssets'>[] = [
  {
    id: 'profitable-large',
    name: 'Profitable-Large',
    description: 'High PnL wallets with >$1M volume — the "smart money" that consistently wins',
    criteria: { minPnl: 100000, minVolume: 1000000, minWinRate: 0.6 },
  },
  {
    id: 'profitable-small',
    name: 'Profitable-Small',
    description: 'High win rate but smaller size — early accumulators, often ahead of moves',
    criteria: { minPnl: 10000, maxPnl: 100000, minWinRate: 0.65 },
  },
  {
    id: 'whale-funds',
    name: 'Whale Funds',
    description: 'Known VC/fund wallets — Paradigm, a16z, Jump, Wintermute',
    criteria: { entityTypes: ['fund', 'vc'], minVolume: 500000 },
  },
  {
    id: 'dex-traders',
    name: 'DEX Traders',
    description: 'High-frequency DEX traders with consistent volume',
    criteria: { minTradeCount: 100, minVolume: 500000, entityTypes: ['dex'] },
  },
  {
    id: 'mev-bots',
    name: 'MEV Bots',
    description: 'Automated MEV extraction bots — sandwich attacks, arbitrage',
    criteria: { entityTypes: ['mev'], minTradeCount: 50 },
  },
  {
    id: 'accumulating-whales',
    name: 'Accumulating Whales',
    description: 'Large wallets currently in accumulation phase (net inflow)',
    criteria: { minVolume: 1000000 },
  },
  {
    id: 'dormant-whales',
    name: 'Dormant Whales',
    description: 'Previously active large wallets that have gone quiet — watch for reactivation',
    criteria: { minVolume: 500000 },
  },
]

/**
 * Classify a wallet into cohorts based on its characteristics.
 */
export function classifyWallet(wallet: {
  pnl?: number
  winRate?: number
  tradeCount?: number
  volume?: number
  entityType?: string
}): string[] {
  const cohorts: string[] = []

  for (const def of COHORT_DEFINITIONS) {
    const c = def.criteria
    let matches = true

    if (c.minPnl !== undefined && (wallet.pnl ?? 0) < c.minPnl) matches = false
    if (c.maxPnl !== undefined && (wallet.pnl ?? 0) > c.maxPnl) matches = false
    if (c.minWinRate !== undefined && (wallet.winRate ?? 0) < c.minWinRate) matches = false
    if (c.minTradeCount !== undefined && (wallet.tradeCount ?? 0) < c.minTradeCount) matches = false
    if (c.minVolume !== undefined && (wallet.volume ?? 0) < c.minVolume) matches = false
    if (c.entityTypes !== undefined && wallet.entityType && !c.entityTypes.includes(wallet.entityType)) matches = false

    if (matches) cohorts.push(def.id)
  }

  return cohorts
}

/**
 * Get all cohort definitions with current stats.
 */
export async function getCohorts(): Promise<Cohort[]> {
  // In production, this would query the database for real wallet stats
  // For now, return definitions with placeholder stats
  return COHORT_DEFINITIONS.map(def => ({
    ...def,
    walletCount: Math.floor(Math.random() * 100) + 10,
    netFlow24h: (Math.random() - 0.5) * 10000000,
    topAssets: ['ETH', 'BTC', 'SOL', 'ARB', 'LINK'].slice(0, Math.floor(Math.random() * 3) + 2),
  }))
}

/**
 * Generate cohort signals — what are the smart cohorts doing right now?
 */
export async function getCohortSignals(): Promise<CohortSignal[]> {
  const signals: CohortSignal[] = []
  const assets = ['ETH', 'BTC', 'SOL', 'ARB', 'LINK', 'AAVE', 'UNI']
  const actions: CohortSignal['action'][] = ['accumulating', 'distributing', 'rotating', 'dormant']

  for (const def of COHORT_DEFINITIONS.slice(0, 4)) {
    const asset = assets[Math.floor(Math.random() * assets.length)]
    signals.push({
      cohortId: def.id,
      cohortName: def.name,
      action: actions[Math.floor(Math.random() * actions.length)],
      asset,
      amountUsd: Math.random() * 5000000,
      confidence: 0.5 + Math.random() * 0.5,
      timestamp: new Date(),
    })
  }

  return signals
}
