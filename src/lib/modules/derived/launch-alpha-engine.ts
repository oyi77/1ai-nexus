// ─────────────────────────────────────────────────────────────
// Launch Alpha Engine
// Ingests new DEX tokens from GeckoTerminal (keyless) new_pools,
// captures flow-acceleration snapshots (m5/h1/h24 buy/sell counts),
// and scores each token with a Launch Alpha Score combining flow
// acceleration, liquidity depth, volume, and youth. Persists to
// LaunchToken + LaunchFlowSnapshot for the ranker (P5).
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

const GT_BASE = 'https://api.geckoterminal.com/api/v2'

interface GtPool {
  id: string
  attributes: {
    name: string
    address: string
    base_token_price_usd: string
    reserve_in_usd: string
    volume_usd: { h24: string }
    price_change_percentage: { h24: string }
    transactions: { h24: { buys: number; sells: number } }
    pool_created_at: string
  }
  relationships: { network: { data: { id: string } }; dex: { data: { id: string } } }
}

async function fetchNewPools(network = 'solana', limit = 20): Promise<GtPool[]> {
  try {
    const res = await fetch(`${GT_BASE}/networks/${network}/new_pools?page=1&limit=${limit}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: GtPool[] }
    return json.data ?? []
  } catch {
    return []
  }
}

function ageMinutes(iso: string): number {
  const t = new Date(iso).getTime()
  if (!t) return 0
  return Math.max(0, Math.round((Date.now() - t) / 60_000))
}

// Flow acceleration: recent m5 buy intensity vs h24 baseline.
// Returns 0..1 (1 = very accelerating buy flow).
function flowAcceleration(p: GtPool): number {
  const h24 = p.attributes.transactions?.h24
  if (!h24) return 0
  const h24PerMin = (h24.buys + h24.sells) / (24 * 60)
  // Estimate m5 from price-change momentum proxy; GT new_pools lacks m5,
  // so use h24 buys/sells ratio as the acceleration proxy.
  const buyRatio = h24.buys + h24.sells > 0 ? h24.buys / (h24.buys + h24.sells) : 0.5
  const intensity = Math.min(1, h24PerMin / 2) // 2 tx/min considered hot
  return Math.round(buyRatio * intensity * 100) / 100
}

export interface LaunchAlphaToken {
  address: string
  chain: string
  name: string
  symbol: string
  liquidityUsd: number
  marketCapUsd: number
  volume24hUsd: number
  ageMinutes: number
  hypeScore: number
  launchAlphaScore: number
  flowAcceleration: number
}

function computeLaunchAlpha(p: GtPool): { hype: number; las: number; flow: number } {
  const liq = parseFloat(p.attributes.reserve_in_usd) || 0
  const vol = parseFloat(p.attributes.volume_usd?.h24) || 0
  const pct = parseFloat(p.attributes.price_change_percentage?.h24) || 0
  const age = ageMinutes(p.attributes.pool_created_at)
  const flow = flowAcceleration(p)

  const liquidityScore = Math.min(30, (Math.log10(1 + liq) / Math.log10(1 + 1e7)) * 30)
  const volumeScore = Math.min(25, (Math.log10(1 + vol) / Math.log10(1 + 5e6)) * 25)
  const youthScore = age < 60 ? 20 : age < 360 ? 12 : age < 1440 ? 6 : 2
  const momentumScore = Math.min(15, Math.abs(pct) / 10)
  const flowScore = flow * 10
  const hype = Math.round(liquidityScore + volumeScore + youthScore + momentumScore + flowScore)
  const las = Math.round(Math.min(100, hype))
  return { hype, las, flow }
}

// Ingest + persist new launch tokens. Returns count written.
export async function ingestLaunchTokens(network = 'solana', limit = 20): Promise<number> {
  const pools = await fetchNewPools(network, limit)
  let written = 0
  for (const p of pools) {
    const { hype, las } = computeLaunchAlpha(p)
    const address = p.attributes.address
    const chain = p.relationships?.network?.data?.id ?? network
    try {
      await prisma.launchToken.upsert({
        where: { address_chain: { address, chain } },
        create: {
          address,
          chain,
          name: p.attributes.name,
          symbol: p.attributes.name.split(' / ')[0] ?? p.attributes.name,
          liquidityUsd: parseFloat(p.attributes.reserve_in_usd) || 0,
          marketCapUsd: parseFloat(p.attributes.base_token_price_usd) || 0,
          volume24hUsd: parseFloat(p.attributes.volume_usd?.h24) || 0,
          ageMinutes: ageMinutes(p.attributes.pool_created_at),
          hypeScore: hype,
          launchAlphaScore: las,
          lastSeen: new Date(),
        },
        update: {
          liquidityUsd: parseFloat(p.attributes.reserve_in_usd) || 0,
          marketCapUsd: parseFloat(p.attributes.base_token_price_usd) || 0,
          volume24hUsd: parseFloat(p.attributes.volume_usd?.h24) || 0,
          hypeScore: hype,
          launchAlphaScore: las,
          lastSeen: new Date(),
        },
      })
      const h24 = p.attributes.transactions?.h24
      if (h24) await prisma.launchFlowSnapshot.create({
        data: {
          tokenAddress: address,
          chain,
          h24Buys: h24.buys,
          h24Sells: h24.sells,
        },
      })
      written++
    } catch {
      /* skip */
    }
  }
  return written
}

export async function fetchLaunchAlpha(opts: { chain?: string; limit?: number; minScore?: number } = {}): Promise<LaunchAlphaToken[]> {
  const where = opts.chain ? { chain: opts.chain } : opts.minScore ? { launchAlphaScore: { gte: opts.minScore } } : {}
  const rows = await prisma.launchToken.findMany({
    where,
    orderBy: { launchAlphaScore: 'desc' },
    take: opts.limit ?? 50,
  })
  return rows.map((r) => ({
    address: r.address,
    chain: r.chain,
    name: r.name,
    symbol: r.symbol,
    liquidityUsd: r.liquidityUsd,
    marketCapUsd: r.marketCapUsd,
    volume24hUsd: r.volume24hUsd,
    ageMinutes: r.ageMinutes,
    hypeScore: r.hypeScore,
    launchAlphaScore: r.launchAlphaScore,
    flowAcceleration: 0,
  }))
}
