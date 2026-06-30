import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// Narrative / Sector Rotation Tracker Module
// Detects capital rotation between crypto narratives
// Uses CoinGecko categories + existing smart money data
// Zero API keys
// ─────────────────────────────────────────────────────────────

export interface SectorFlow {
  sector: string
  marketCap: number
  volume24h: number
  change24h: number
  change7d: number
  topCoins: string[]
  signal: 'inflow' | 'outflow' | 'neutral'
  timestamp: string
}

export async function fetchNarrativeRotation(): Promise<SectorFlow[]> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/categories', {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const data = await res.json() as Array<{
      name: string
      market_cap: number
      volume_24h: number
      market_cap_change_24h: number
      market_cap_change_7d?: number
      top_3_coins: string[]
    }>

    return data
      .filter(cat => cat.market_cap > 100_000_000)
      .map(cat => {
        const change24h = cat.market_cap_change_24h ?? 0
        const change7d = cat.market_cap_change_7d ?? 0
        const signal: SectorFlow['signal'] = change24h > 3 ? 'inflow' : change24h < -3 ? 'outflow' : 'neutral'

        return {
          sector: cat.name,
          marketCap: cat.market_cap,
          volume24h: cat.volume_24h,
          change24h,
          change7d,
          topCoins: cat.top_3_coins ?? [],
          signal,
          timestamp: new Date().toISOString(),
        }
      })
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 30)
  } catch { return [] }
}

export async function persistSectorFlows(flows: SectorFlow[]): Promise<number> {
  let persisted = 0
  for (const flow of flows) {
    try {
      await prisma.sectorFlowSnapshot.create({
        data: {
          sector: flow.sector,
          netSmartMoneyFlowUsd: flow.change24h, // Using change24h as flow proxy
          tokenCount: flow.topCoins.length,
        },
      })
      persisted++
    } catch { /* skip */ }
  }
  return persisted
}
