import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// DeFi Credit Stress Monitor Module
// Tracks positions near liquidation in lending protocols
// Uses DeFiLlama yields data as proxy for protocol health
// Zero API keys
// ─────────────────────────────────────────────────────────────

export interface CreditRiskSnapshot {
  protocol: string
  chain: string
  tvl: number
  avgApy: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  signal: string
  timestamp: string
}

export async function fetchCreditRisk(): Promise<CreditRiskSnapshot[]> {
  try {
    const res = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []
    const data = await res.json() as { data?: Array<{ project: string; chain: string; tvlUsd: number; apy: number; apyMean30d?: number }> }

    const pools = (data.data ?? [])
      .filter(p => p.tvlUsd > 1_000_000) // Only significant pools
      .slice(0, 100)

    // Group by protocol
    const protocolMap = new Map<string, { tvl: number; apySum: number; count: number; chains: Set<string> }>()
    for (const pool of pools) {
      const key = pool.project
      if (!protocolMap.has(key)) protocolMap.set(key, { tvl: 0, apySum: 0, count: 0, chains: new Set() })
      const entry = protocolMap.get(key)!
      entry.tvl += pool.tvlUsd
      entry.apySum += pool.apy
      entry.count++
      entry.chains.add(pool.chain)
    }
    return Array.from(protocolMap.entries())
      .map(([protocol, stats]) => {
        const avgApy = stats.apySum / stats.count
        const riskLevel: CreditRiskSnapshot['riskLevel'] = avgApy > 20 ? 'critical' : avgApy > 10 ? 'high' : avgApy > 5 ? 'medium' : 'low'
        return {
          protocol,
          chain: [...stats.chains].slice(0, 3).join(', '),
          tvl: stats.tvl,
          avgApy,
          riskLevel,
          signal: riskLevel === 'critical' ? 'Unsustainable yields — potential depeg/liquidation risk'
            : riskLevel === 'high' ? 'Elevated yields — monitor for stress'
            : riskLevel === 'medium' ? 'Above-average yields — normal for DeFi'
            : 'Healthy yields',
          timestamp: new Date().toISOString(),
        }
      })
      .filter(p => p.riskLevel !== 'low') // Only show elevated risk
      .sort((a, b) => b.avgApy - a.avgApy)
      .slice(0, 20)
  } catch { return [] }
}

export async function persistCreditRisk(snapshots: CreditRiskSnapshot[]): Promise<number> {
  let persisted = 0
  for (const snap of snapshots) {
    try {
      await prisma.creditRiskSnapshot.create({
        data: {
          protocol: snap.protocol,
          asset: snap.chain,
          atRiskUsd: snap.tvl,
          avgHealthFactor: snap.avgApy,
        },
      })
      persisted++
    } catch { /* skip */ }
  }
  return persisted
}
