import { describe, expect, it } from 'vitest'
import {
  getBrokerBoard,
  getForeignLeaders,
  getForeignSeries,
  getForeignStreaks,
} from '@/lib/modules/market/provider/idx-bandarmology'
import { applyIcSector } from '@/lib/modules/market/provider/idx-universe'
import { fetchTopCryptoSymbols } from '@/lib/modules/market/provider/binance-top'

// These run against the COMMITTED snapshots in data/idx/, so they
// are deterministic within a given commit state.

describe('idx-bandarmology provider', () => {
  it('leaders are ranked by estimated net value and include meta', async () => {
    const l = await getForeignLeaders(10)
    expect(l.meta.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(l.topBuy.length).toBeGreaterThan(0)
    expect(l.topSell.length).toBeGreaterThan(0)
    for (let i = 1; i < l.topBuy.length; i++) {
      expect(l.topBuy[i - 1].estNetValueIdr).toBeGreaterThanOrEqual(l.topBuy[i].estNetValueIdr)
    }
    for (const row of [...l.topBuy, ...l.topSell]) {
      expect(row.code).toBeTruthy()
      expect(row.close).toBeGreaterThan(0)
    }
  })

  it('streaks carry direction and minimum day count', async () => {
    const s = await getForeignStreaks(1, 10)
    for (const row of [...s.accumulation, ...s.distribution]) {
      expect(row.days).toBeGreaterThanOrEqual(1)
      expect(['accumulation', 'distribution']).toContain(row.direction)
    }
  })

  it('broker board is sorted by turnover desc', async () => {
    const b = await getBrokerBoard(25)
    expect(b.rows.length).toBeGreaterThan(0)
    for (let i = 1; i < b.rows.length; i++) {
      expect(b.rows[i - 1].value).toBeGreaterThanOrEqual(b.rows[i].value)
    }
  })

  it('series returns null-safe shape for known and unknown symbols', async () => {
    const known = await getForeignSeries('BBCA', 30)
    if (known) {
      expect(known.symbol).toBe('BBCA.JK')
      expect(known.series.length).toBeGreaterThan(0)
      for (const point of known.series) expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const unknown = await getForeignSeries('ZZZZZ', 30)
    expect(unknown).toBeNull()
  })
})

describe('applyIcSector taxonomy translation', () => {
  it('maps TradingView sectors to IDX-IC style labels', () => {
    expect(applyIcSector({ sector: 'Finance' }).icSector).toBe('Financials')
    expect(applyIcSector({ sector: 'Communications' }).icSector).toBe('Infrastructure')
  })
  it('passes through unmapped sectors unchanged', () => {
    expect(applyIcSector({ sector: 'Mystery Sector' }).icSector).toBe('Mystery Sector')
  })
  it('omits icSector when sector absent', () => {
    const out = applyIcSector({})
    expect('icSector' in out).toBe(false)
  })
})

describe.skipIf(!process.env.RUN_NETWORK_TESTS)('binance-top provider', () => {
  it('returns USDT-only bases without stables or leveraged tokens', async () => {
    const top = await fetchTopCryptoSymbols(9)
    expect(top.length).toBeLessThanOrEqual(9)
    for (const t of top) {
      expect(t.symbol.endsWith('USDT')).toBe(false)
      expect(['USDC', 'FDUSD', 'TUSD']).not.toContain(t.symbol)
      expect(/(UP|DOWN|BULL|BEAR)$/.test(t.symbol)).toBe(false)
    }
  })
})
