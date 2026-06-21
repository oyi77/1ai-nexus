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
  // TODO: Wire to Prisma — query SmartMoneyWallet + Transaction tables
  // for real cohort aggregations. Currently returns definitions only.
  return COHORT_DEFINITIONS.map(def => ({
    ...def,
    walletCount: 0,
    netFlow24h: 0,
    topAssets: [],
  }))
}

/**
 * Generate cohort signals — what are the smart cohorts doing right now?
 */
export async function getCohortSignals(): Promise<CohortSignal[]> {
  // TODO: Wire to Prisma — derive signals from real transaction patterns.
  // Currently returns empty until real data pipeline is implemented.
  return []
}
