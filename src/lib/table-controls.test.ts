import { describe, expect, it } from 'vitest'
import { cellString, compareCells, filterRows, nextSort, sortRows } from './table-controls'

describe('cellString', () => {
  it('renders null and undefined as empty string', () => {
    expect(cellString(null)).toBe('')
    expect(cellString(undefined)).toBe('')
    expect(cellString(0)).toBe('0')
    expect(cellString(false)).toBe('false')
  })
})

describe('compareCells', () => {
  it('compares numbers numerically', () => {
    expect(compareCells(2, 10)).toBeLessThan(0)
    expect(compareCells(10, 2)).toBeGreaterThan(0)
    expect(compareCells(5, 5)).toBe(0)
  })

  it('falls back to string comparison for mixed or textual values', () => {
    expect(compareCells('btc', 'eth')).toBeLessThan(0)
    expect(compareCells(1, 'a')).toBeLessThan(0)
    expect(compareCells(null, 'x')).toBeLessThanOrEqual(0)
  })
})

describe('filterRows', () => {
  const rows = [
    { symbol: 'BTC', vol: 100 },
    { symbol: 'ETH', vol: 50 },
    { symbol: 'SOL', vol: 75 },
  ]

  it('is a no-op for blank or whitespace queries', () => {
    expect(filterRows(rows, '', { symbol: r => r.symbol })).toHaveLength(3)
    expect(filterRows(rows, '   ', {})).toHaveLength(3)
  })

  it('matches case-insensitively across accessor values', () => {
    const out = filterRows(rows, 'et', { symbol: r => r.symbol })
    expect(out).toEqual([{ symbol: 'ETH', vol: 50 }])
  })

  it('searches every own row value when no accessors are provided', () => {
    expect(filterRows(rows, '75', {})).toEqual([{ symbol: 'SOL', vol: 75 }])
  })

  it('never matches rows whose accessor returns null or undefined', () => {
    const sparse = [{ a: 'hit' as string | null }, { a: null }]
    expect(filterRows(sparse, 'hit', { a: r => r.a })).toEqual([{ a: 'hit' }])
    expect(filterRows(sparse, 'null', { a: r => r.a })).toEqual([])
  })
})

describe('sortRows', () => {
  const rows = [
    { sym: 'B', n: 3 },
    { sym: 'A', n: 10 },
    { sym: 'C', n: 1 },
  ]

  it('returns input order when key is null', () => {
    expect(sortRows(rows, null, 'asc', {})).toBe(rows)
  })

  it('sorts numerically and respects direction with desc default semantics', () => {
    const acc = { n: (r: { n: number }) => r.n }
    expect(sortRows(rows, 'n', 'desc', acc).map(r => r.n)).toEqual([10, 3, 1])
    expect(sortRows(rows, 'n', 'asc', acc).map(r => r.n)).toEqual([1, 3, 10])
  })

  it('prefers the accessor over the raw field value', () => {
    const out = sortRows(rows, 'sym', 'asc', { sym: (r: { sym: string }) => r.sym.toLowerCase() })
    expect(out.map(r => r.sym)).toEqual(['A', 'B', 'C'])
  })

  it('does not mutate the input array', () => {
    const snapshot = [...rows]
    sortRows(rows, 'n', 'asc', { n: r => r.n })
    expect(rows).toEqual(snapshot)
  })

  it('keeps ties in input order (stable)', () => {
    const tied = [
      { k: 'x', v: 1 },
      { k: 'y', v: 1 },
    ]
    expect(sortRows(tied, 'v', 'desc', { v: r => r.v }).map(r => r.k)).toEqual(['x', 'y'])
  })
})

describe('nextSort', () => {
  it('starts descending on a new column', () => {
    expect(nextSort(null, 'desc', 'vol')).toEqual({ key: 'vol', dir: 'desc' })
    expect(nextSort('price', 'asc', 'vol')).toEqual({ key: 'vol', dir: 'desc' })
  })

  it('flips direction on the same column', () => {
    expect(nextSort('vol', 'desc', 'vol')).toEqual({ key: 'vol', dir: 'asc' })
    expect(nextSort('vol', 'asc', 'vol')).toEqual({ key: 'vol', dir: 'desc' })
  })
})
