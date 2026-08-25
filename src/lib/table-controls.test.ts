import { cellString, compareCells, filterRows, nextSort, parseCellNumber, sortRows } from './table-controls'
import { describe, expect, it } from 'vitest'

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

describe('parseCellNumber', () => {
  it('parses plain numbers and finite checks', () => {
    expect(parseCellNumber(42)).toBe(42)
    expect(parseCellNumber(-3.5)).toBe(-3.5)
    expect(parseCellNumber(Number.NaN)).toBeNull()
    expect(parseCellNumber(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('parses formatted currency, percent, and SI-suffixed strings', () => {
    expect(parseCellNumber('$80,060')).toBe(80060)
    expect(parseCellNumber('$2,487')).toBe(2487)
    expect(parseCellNumber('+3.8%')).toBe(3.8)
    expect(parseCellNumber('45K')).toBe(45000)
    expect(parseCellNumber('2.5M')).toBe(2_500_000)
    expect(parseCellNumber('1.2B')).toBe(1_200_000_000)
    expect(parseCellNumber('-$1.2B')).toBe(-1_200_000_000)
    expect(parseCellNumber('(1,234)')).toBe(-1234)
    expect(parseCellNumber('.5')).toBe(0.5)
  })

  it('rejects non-numeric text entirely', () => {
    expect(parseCellNumber('btc')).toBeNull()
    expect(parseCellNumber('BTC 0.3%')).toBeNull()
    expect(parseCellNumber('—')).toBeNull()
    expect(parseCellNumber('')).toBeNull()
    expect(parseCellNumber(null)).toBeNull()
    expect(parseCellNumber(undefined)).toBeNull()
  })
})

describe('compareCells numeric-string awareness', () => {
  it('orders formatted currency numerically instead of lexically', () => {
    // Lexical order would put "$100..." before "$80...".
    expect(compareCells('$80,060', '$2,487')).toBeGreaterThan(0)
    expect(compareCells('$2,487', '$80,060')).toBeLessThan(0)
  })

  it('compares percent strings by face value', () => {
    expect(compareCells('+3.8%', '-1.2%')).toBeGreaterThan(0)
  })

  it('falls back to deterministic string comparison when either side is not numeric', () => {
    expect(compareCells('btc', 'abc')).toBeGreaterThan(0)
    expect(compareCells('abc', 'btc')).toBeLessThan(0)
    expect(Number.isFinite(compareCells('btc', '$100'))).toBe(true)
    expect(compareCells('BTC 0.3%', 'abc')).not.toBeNaN()
  })


  it('sorts mixed formatted rows correctly through sortRows', () => {
    const rows = [
      { price: '$100.00' },
      { price: '$80,060' },
      { price: '$2,487' },
    ]
    const out = sortRows(rows, 'price', 'desc', {})
    expect(out.map(r => r.price)).toEqual(['$80,060', '$2,487', '$100.00'])
  })
})
