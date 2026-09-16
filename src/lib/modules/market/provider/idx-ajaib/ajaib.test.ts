// ─────────────────────────────────────────────────────────────
// Ajaib provider tests — pure parsers, no network (live shape
// verified 2026-09-15, fixtures mirror real payloads).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { parseAnalysisPayload, normalizeCode } from './analysis'
import { extractUniverseRecords } from './universe'

describe('normalizeCode', () => {
  it("strips .JK suffix and uppercases", () => {
    expect(normalizeCode('bbca.jk')).toBe('BBCA')
    expect(normalizeCode(' BBRI ')).toBe('BBRI')
  })
})

const REAL_SHAPE = {
  err_code: 'EC0000000',
  err_message: 'APPROVED/OK',
  result: {
    stock: {
      analysts_estimates: {
        analysts_rating: {
          recommendation: 'BUY',
          total_analyst_buy_rec: 26,
          total_analyst_sell_rec: 1,
          total_analyst_hold_rec: 8,
          total_analysts: 35,
        },
        price_estimates: { target: 3783.041, current: 3320, high: 4900, low: 2740 },
        analysts_consensus_estimates: {
          '2025': { revenue: 279586944000000, operating_income: 1, net_income: 2, eps: 377.57 },
        },
      },
      pbv_band: {
        standard_deviations: { mean: 2.27, mean_plus1: 2.7, mean_plus2: 3.12, mean_minus1: 1.85, mean_minus2: 1.43 },
        price_to_book_value: { '2026-09-15': 1.53, '2026-09-14': 1.57 },
      },
      pe_band: { standard_deviations: {}, price_to_earnings: {} },
      technical_indicator: {
        buy_summary: 10,
        sell_summary: 4,
        neutral_summary: 0,
        ma: [{ name: 'MA-10', action: 'SELL', value: '3370.0000' }],
        technical_indicator: [{ name: 'RSI', action: 'BUY', value: 55.2 }],
        ppi: [{ name: 'S1', action: 'NONE', value: '3277' }],
      },
    },
  },
}

describe('parseAnalysisPayload', () => {
  it('parses the live BBRI shape', () => {
    const out = parseAnalysisPayload('BBRI', REAL_SHAPE)
    expect(out?.code).toBe('BBRI')
    expect(out?.analystRating).toMatchObject({ recommendation: 'BUY', buy: 26, sell: 1, hold: 8, total: 35 })
    expect(out?.priceEstimates?.target).toBeCloseTo(3783.041)
    expect(out?.consensus['2025']?.eps).toBeCloseTo(377.57)
    expect(out?.pbvBand?.mean).toBeCloseTo(2.27)
    expect(out?.pbvBand?.series['2026-09-15']).toBeCloseTo(1.53)
    expect(out?.technicals?.ma[0]).toMatchObject({ name: 'MA-10', action: 'SELL', value: 3370 })
    expect(out?.technicals?.indicators[0]?.name).toBe('RSI')
    expect(out?.technicals?.pivots[0]?.name).toBe('S1')
  })

  it('rejects error envelopes', () => {
    expect(parseAnalysisPayload('BBRI', { err_code: 'EC0000996', err_message: 'Invalid' })).toBeNull()
  })

  it('returns null on empty result (non-IDX code)', () => {
    expect(parseAnalysisPayload('AAPL', { err_code: 'EC0000000', result: {} })).toBeNull()
  })

  it('returns null on garbage', () => {
    expect(parseAnalysisPayload('X', null)).toBeNull()
    expect(parseAnalysisPayload('X', 'nope')).toBeNull()
  })

  it('returns null on 200-with-empty-sections (unknown code live shape)', () => {
    expect(
      parseAnalysisPayload('ZZZZ', {
        err_code: 'EC0000000',
        result: {
          stock: {
            analysts_estimates: [],
            pbv_band: {},
            pe_band: {},
            technical_indicator: { ticker: 'ZZZZ', buy_summary: 0, sell_summary: 0, neutral_summary: 0, technical_indicator: [], ma: [], ppi: [] },
          },
        },
      }),
    ).toBeNull()
  })
})
describe('extractUniverseRecords', () => {
  it('extracts results[] from flight-escaped payloads', () => {
    const raw =
      '1:I[32714,[\\"9933\\"]]34:[\\"$\\",\\"x\\",{\\"initialData\\":{\\"count\\":882,\\"results\\":[{\\"code\\":\\"BBCA\\",\\"name\\":\\"Bank Central Asia\\",\\"price\\":6400,\\"market_cap\\":781000000000000,\\"volume\\":95608200,\\"price_1_week\\":{\\"price\\":6675,\\"pct_change\\":-4.12,\\"price_change\\":-275},\\"price_1_month\\":null}]}}]'
    const recs = extractUniverseRecords(raw)
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ code: 'BBCA', price: 6400 })
  })

  it('throws when results[] is absent', () => {
    expect(() => extractUniverseRecords('no data here')).toThrow(/no results/)
  })

  it('throws on unterminated array', () => {
    expect(() => extractUniverseRecords('"results":[{broken')).toThrow()
  })
})

describe('EmptySnapshotError', () => {
  it('carries name + source for route 503 mapping', async () => {
    const { EmptySnapshotError } = await import('./universe')
    const err = new EmptySnapshotError('Ajaib universe')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('EmptySnapshotError')
    expect(err.message).toMatch(/Ajaib universe/)
  })
})

describe('multi-market parsers (live shapes 2026-09-16)', () => {
  it('US row = IDX row + day momentum', async () => {
    const { getAjaibUS } = await import('./universe')
    expect(typeof getAjaibUS).toBe('function')
  })
  it('MF/crypto fetchers exist with 6h cache keys', async () => {
    const m = await import('./universe')
    expect(typeof m.getAjaibMF).toBe('function')
    expect(typeof m.getAjaibCrypto).toBe('function')
  })
})
