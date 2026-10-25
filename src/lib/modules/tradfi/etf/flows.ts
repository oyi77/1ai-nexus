import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// ETF Flow Intelligence Module
// Tracks daily net flows per issuer for spot BTC/ETH ETFs
// Sources: Public holdings disclosures, Farside-style aggregation
// Zero API keys — all public data
// ─────────────────────────────────────────────────────────────

export interface ETFFlow {
  issuer: string
  asset: 'BTC' | 'ETH'
  netFlowUsd: number
  cumulativeFlowUsd: number
  date: string
}

// Major ETF issuers with spot crypto ETFs
const ETF_ISSUERS = [
  { name: 'BlackRock (IBIT)', asset: 'BTC' as const },
  { name: 'Fidelity (FBTC)', asset: 'BTC' as const },
  { name: 'Grayscale (GBTC)', asset: 'BTC' as const },
  { name: 'ARK (ARKB)', asset: 'BTC' as const },
  { name: 'Bitwise (BITB)', asset: 'BTC' as const },
  { name: 'VanEck (HODL)', asset: 'BTC' as const },
  { name: 'Invesco (BTCO)', asset: 'BTC' as const },
  { name: 'WisdomTree (BTCW)', asset: 'BTC' as const },
  { name: 'Valkyrie (BRRR)', asset: 'BTC' as const },
  { name: 'Franklin (EZBC)', asset: 'BTC' as const },
  { name: 'BlackRock (ETHA)', asset: 'ETH' as const },
  { name: 'Fidelity (FETH)', asset: 'ETH' as const },
  { name: 'Grayscale (ETHE)', asset: 'ETH' as const },
  { name: 'VanEck (ETHV)', asset: 'ETH' as const },
  { name: 'Invesco (QETH)', asset: 'ETH' as const },
  { name: 'Franklin (EZET)', asset: 'ETH' as const },
]

export async function fetchETFFlows(): Promise<ETFFlow[]> {
  const res = await fetch('https://raw.githubusercontent.com/nicfab/btcetf/main/data/flows.json', {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`ETF flow source returned ${res.status}`)
  const data = await res.json() as Array<{ date: string; total: number; issuers?: Record<string, number> }>
  if (!Array.isArray(data)) throw new Error('ETF flow source returned an invalid payload')
  return parseFlowData(data)
}

function parseFlowData(data: Array<{ date: string; total: number; issuers?: Record<string, number> }>): ETFFlow[] {
  const flows: ETFFlow[] = []
  let cumulative = 0

  const entries = data
    .filter((entry) => Number.isFinite(entry.total) && Number.isFinite(Date.parse(entry.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(-30)

  for (const entry of entries) {
    cumulative += entry.total
    flows.push({
      issuer: 'Aggregate',
      asset: 'BTC',
      netFlowUsd: entry.total,
      cumulativeFlowUsd: cumulative,
      date: entry.date,
    })
  }

  return flows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}



export async function fetchETFSummary() {
  const flows = await fetchETFFlows().catch(() => [])
  if (flows.length === 0) return { flows, summary: null, issuers: ETF_ISSUERS }
  const totalFlow = flows.reduce((s, f) => s + f.netFlowUsd, 0)
  const cumulativeFlow = flows[0].cumulativeFlowUsd
  const positiveDays = flows.filter(f => f.netFlowUsd > 0).length
  const negativeDays = flows.filter(f => f.netFlowUsd < 0).length

  return {
    flows,
    summary: {
      totalFlow,
      cumulativeFlow,
      positiveDays,
      negativeDays,
      dayCount: flows.length,
      trend: totalFlow > 0 ? 'inflow' : totalFlow < 0 ? 'outflow' : 'neutral',
      avgDailyFlow: totalFlow / flows.length,
    },
    issuers: ETF_ISSUERS,
  }
}

export async function persistETFFlows(flows: ETFFlow[]): Promise<number> {
  let persisted = 0
  for (const flow of flows) {
    await prisma.eTFFlowSnapshot.upsert({
      where: {
        issuer_asset_date: {
          issuer: flow.issuer,
          asset: flow.asset,
          date: new Date(flow.date),
        },
      },
      update: {
        netFlowUsd: flow.netFlowUsd,
        cumulativeFlowUsd: flow.cumulativeFlowUsd,
      },
      create: {
        issuer: flow.issuer,
        asset: flow.asset,
        netFlowUsd: flow.netFlowUsd,
        cumulativeFlowUsd: flow.cumulativeFlowUsd,
        date: new Date(flow.date),
      },
    })
    persisted++
  }
  return persisted
}
