import { describe, expect, it } from 'vitest'
import { AnalyticsIndex, RankedList } from '../analytics-index'

describe('RankedList.countAboveOrEqual', () => {
  const mk = (vals: number[]) => new RankedList(vals.map((v, i) => ({ key: `k${i}`, value: v })))

  it('matches naive prefix count on descending-sorted values', () => {
    const rl = mk([900, 700, 700, 500, 100])
    for (const t of [0, 99, 100, 101, 499, 500, 501, 699, 700, 701, 900, 901]) {
      const naive = [900, 700, 700, 500, 100].filter((v) => v >= t).length
      expect(rl.countAboveOrEqual(t)).toBe(naive)
    }
  })

  it('handles empty and single-entry lists', () => {
    expect(new RankedList([]).countAboveOrEqual(1)).toBe(0)
    expect(mk([42]).countAboveOrEqual(42)).toBe(1)
    expect(mk([42]).countAboveOrEqual(43)).toBe(0)
  })

  it('fuzzes against naive scan with deterministic pseudo-randoms', () => {
    let a = 42
    const rand = () => {
      a = (a * 1103515245 + 12345) % 2147483648
      return a / 2147483648
    }
    for (let trial = 0; trial < 20; trial++) {
      const vals = Array.from({ length: 200 }, () => Math.floor(rand() * 1000))
      const rl = mk(vals)
      for (let t = -10; t < 1010; t += 37) {
        const naive = vals.filter((v) => v >= t).length
        expect(rl.countAboveOrEqual(t)).toBe(naive)
      }
    }
  })
})

describe('AnalyticsIndex', () => {
  const idx = new AnalyticsIndex({
    universeStocks: [
      { symbol: 'A.JK', sector: 'Finance' },
      { symbol: 'B.JK', sector: 'Finance' },
      { symbol: 'C.JK', sector: 'Tech' },
    ],
    sahamRows: [
      { code: 'A', close: 100, foreignBuy: 5, foreignSell: 1, value: 900 },
      { code: 'B', close: 200, foreignBuy: 1, foreignSell: 3, value: 400 },
      { code: 'C', close: 300, value: 1200 },
    ],
    brokerRows: [{ IDFirm: 'XY', value: 700 }],
    foreignHistory: { A: [{ tradeDate: '2026-08-25', net: 4 }] },
    fundamentalsData: { A: { per: 12.5 } },
  })

  it('sectorRollup memoizes identical results', () => {
    const first = idx.sectorRollup('Finance')
    const second = idx.sectorRollup('Finance')
    expect(second).toBe(first) // same object → memoized
    expect(first.totalSymbols).toBe(2)
    expect(first.withTradingRow).toBe(2)
    expect(idx.sectorRollup('Missing').totalSymbols).toBe(0)
  })

  it('indexes lookups and instrument count across all five datasets', () => {
    expect(idx.universeBySymbol.has('C.JK')).toBe(true)
    expect(idx.sahamByCode.has('B')).toBe(true)
    expect(idx.brokerByFirm.has('XY')).toBe(true)
    expect(idx.foreignSeriesByCode.get('A')?.[0]?.net).toBe(4)
    expect(idx.fundamentalsByCode.get('A')?.per).toBe(12.5)
    expect(idx.instrumentCount).toBe(3 + 3 + 1 + 1 + 1)
  })
})
