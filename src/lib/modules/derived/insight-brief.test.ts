// Contract test: cross-domain transmission engine — direction rules,
// measured-vs-unproven confidence labeling, regime derivation.
// Calibration cells are mocked (their own recompute is covered by
// brief-calibration tests); $queryRaw is dispatched per query shape.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/server-cache', () => ({
  getCached: vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => ({
    data: await fetcher(),
    fromCache: false,
  })),
}))

vi.mock('@/lib/modules/derived/brief-calibration', () => ({
  getFundingCells: vi.fn(async () => ({
    asOf: '2026-09-21',
    cells: {
      Binance: {
        long: { '2': { n: 2609, hits: 1403 }, '3': { n: 866, hits: 459 }, '5': { n: 446, hits: 228 } },
        short: { '2': { n: 2122, hits: 1044 }, '3': { n: 936, hits: 449 }, '5': { n: 663, hits: 319 } },
      },
      Bybit: {
        long: { '2': { n: 329, hits: 181 }, '3': { n: 141, hits: 79 }, '5': { n: 93, hits: 50 } },
        short: { '2': { n: 549, hits: 248 }, '3': { n: 269, hits: 123 }, '5': { n: 181, hits: 94 } },
      },
    },
  })),
  getSectorCells: vi.fn(async () => ({
    asOf: '2026-09-21',
    top: { n: 115, hits: 73 },
    bottom: { n: 101, hits: 67 },
  })),
  getForeignCells: vi.fn(async () => ({
    asOf: '2026-09-22',
    spreadPp: 0.36,
    rankIC: 0.044,
    days: 67,
    broadHitPct: 44.8,
    broadN: 67,
  })),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    alphaTrackRecord: { findMany: vi.fn() },
    idxSahamSession: { findMany: vi.fn() },
    sentimentSnapshot: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/db'
import { buildInsightBrief } from './insight-brief'

const m = vi.mocked

interface FundingStatRow { exchange: string; symbol: string; rate: number; mean: number; sd: number }

function mockRaw(opts: {
  funding?: FundingStatRow[]
  foreign?: Array<{ d: string; net: number }>
  sectors?: Array<{ sector: string; net: number }>
  day?: string
}) {
  m(prisma.$queryRaw).mockImplementation((async (q: unknown) => {
    const s = String((q as string[])[0] ?? q)
    if (s.includes('array_agg')) return (opts.funding ?? []) as never
    if (s.includes('foreignBuy')) return (opts.foreign ?? []) as never
    if (s.includes('GROUP BY sector')) return (opts.sectors ?? []) as never
    if (s.includes('AS d FROM')) return (opts.day ? [{ d: new Date(opts.day) }] : []) as never
    return [] as never
  }) as never)
}

describe('insight-brief transmission engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m(prisma.alphaTrackRecord.findMany).mockResolvedValue([] as never)
    m(prisma.idxSahamSession.findMany).mockResolvedValue([] as never)
    m(prisma.sentimentSnapshot.findMany).mockResolvedValue([] as never)
    mockRaw({})
  })

  it('crowded long → bearish with measured unwind; uncovered venue → unproven', async () => {
    mockRaw({
      funding: [
        { exchange: 'Binance', symbol: 'AAAUSDT', rate: 0.03, mean: 0, sd: 0.01 }, // z=+3
        { exchange: 'Kraken', symbol: 'BBBUSDT', rate: -0.02, mean: 0, sd: 0.005 }, // z=-4
      ],
    })

    const brief = await buildInsightBrief()
    const byId = new Map(brief.transmissions.map((t) => [t.id, t]))

    const long = byId.get('funding:Binance:AAAUSDT')
    expect(long).toBeDefined()
    expect(long!.direction).toBe('bearish')
    expect(long!.unproven).toBe(false) // Binance long tier-3 cell covers it
    expect(long!.confidence).toBe(53) // 459/866 unwind
    expect(long!.measured!.n).toBe(866)

    const short = byId.get('funding:Kraken:BBBUSDT')
    expect(short).toBeDefined()
    expect(short!.direction).toBe('bullish') // rate sign negative → shorts pay
    expect(short!.unproven).toBe(true) // no Kraken cell
    expect(short!.confidence).toBe(50)
  })

  it('labels foreign-flow transmission with measured confidence when calibration data exists', async () => {
    // 60% of moonshot rows reach +20% MFE → measured p20 = p10 = 60.
    m(prisma.alphaTrackRecord.findMany).mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({
        verdict: 'moonshot',
        maxGain30dPct: i < 60 ? 25 : 5,
      })) as never,
    )
    m(prisma.idxSahamSession.findMany).mockResolvedValue(
      [{ tradeDate: '2026-10-07' }, { tradeDate: '2026-10-06' }] as never,
    )
    mockRaw({
      foreign: [
        { d: '2026-10-07', net: 5e9 },
        { d: '2026-10-06', net: 3e9 },
      ],
    })

    const brief = await buildInsightBrief()
    const flow = brief.transmissions.find((t) => t.id === 'idx-foreign-flow')
    expect(flow).toBeDefined()
    expect(flow!.direction).toBe('bullish')
    expect(flow!.unproven).toBe(false)
    expect(flow!.measured!.n).toBe(100)
    expect(flow!.measured!.p20).toBe(60)
    expect(flow!.confidence).toBe(60)
  })

  it('falls back to unproven when no calibration rows back the foreign-flow claim', async () => {
    m(prisma.idxSahamSession.findMany).mockResolvedValue([{ tradeDate: '2026-10-07' }] as never)
    mockRaw({ foreign: [{ d: '2026-10-07', net: -2e9 }] })

    const brief = await buildInsightBrief()
    const flow = brief.transmissions.find((t) => t.id === 'idx-foreign-flow')
    expect(flow).toBeDefined()
    expect(flow!.direction).toBe('bearish')
    expect(flow!.unproven).toBe(true)
    expect(flow!.measured).toBeUndefined()
    expect(flow!.confidence).toBe(50)
  })

  it('derives regime from transmission direction counts', async () => {
    // Two crowded shorts (bullish) dominate → risk-on.
    mockRaw({
      funding: [
        { exchange: 'Bybit', symbol: 'XUSDT', rate: -0.05, mean: 0, sd: 0.01 },
        { exchange: 'Bybit', symbol: 'YUSDT', rate: -0.04, mean: 0, sd: 0.01 },
      ],
    })

    const brief = await buildInsightBrief()
    expect(brief.regime).toBe('risk-on')
    expect(brief.transmissions.length).toBe(2)
  })

  it('emits a sentiment-extreme transmission only at extremes', async () => {
    m(prisma.sentimentSnapshot.findMany).mockResolvedValue([{ score: 82 }] as never)
    let brief = await buildInsightBrief()
    expect(brief.transmissions.some((t) => t.id === 'fear-greed-extreme')).toBe(true)
    expect(brief.transmissions.find((t) => t.id === 'fear-greed-extreme')!.direction).toBe('bearish')

    m(prisma.sentimentSnapshot.findMany).mockResolvedValue([{ score: 52 }] as never)
    brief = await buildInsightBrief()
    expect(brief.transmissions.some((t) => t.id === 'fear-greed-extreme')).toBe(false)
  })

  it('sector leg carries pooled persistence as measured confidence', async () => {
    mockRaw({
      sectors: [
        { sector: 'tech', net: 8e6 },
        { sector: 'defi', net: 5e6 },
        { sector: 'l1', net: 3e6 },
        { sector: 'meme', net: -2e6 },
        { sector: 'nft', net: -4e6 },
      ],
      day: '2026-10-07',
    })

    const brief = await buildInsightBrief()
    const leg = brief.transmissions.find((t) => t.id === 'sector-rotation')
    expect(leg).toBeDefined()
    expect(leg!.unproven).toBe(false)
    expect(leg!.confidence).toBe(65) // (73+67)/(115+101) pooled
    expect(leg!.measured!.n).toBe(216)
  })

  it('survives empty data — brief still returns a regime, no throw', async () => {
    const brief = await buildInsightBrief()
    expect(['risk-on', 'risk-off', 'mixed']).toContain(brief.regime)
    expect(brief.transmissions).toEqual([])
    expect(brief.generatedAt).toBeTruthy()
  })
})
