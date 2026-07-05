import { describe, it, expect } from 'vitest'
import { formatPrice, formatPriceUSD, formatPercent, formatCompact } from '../format'

describe('formatPrice', () => {
  it('formats zero', () => {
    expect(formatPrice(0)).toBe('0.00')
  })

  it('formats very small prices (< 0.01) with up to 6 decimals', () => {
    expect(formatPrice(0.001234)).toBe('0.001234')
    expect(formatPrice(0.000001)).toBe('0.000001')
    // 0.0000001 rounds to 0 at 6 decimals
    expect(formatPrice(0.0000001)).toBe('0')
  })

  it('formats small prices (< 1) with up to 4 decimals', () => {
    expect(formatPrice(0.2345)).toBe('0.2345')
    expect(formatPrice(0.1)).toBe('0.1')
    expect(formatPrice(0.99)).toBe('0.99')
  })

  it('formats medium prices (< 100) with 2 decimals', () => {
    expect(formatPrice(1.23)).toBe('1.23')
    expect(formatPrice(45.678)).toBe('45.68')
    expect(formatPrice(99.99)).toBe('99.99')
  })

  it('formats large prices (< 10000) with comma separator', () => {
    expect(formatPrice(1234.56)).toBe('1,234.56')
    expect(formatPrice(9999.99)).toBe('9,999.99')
  })

  it('formats very large prices without decimals', () => {
    expect(formatPrice(10000)).toBe('10,000')
    expect(formatPrice(61248.99)).toBe('61,249')
    expect(formatPrice(1000000)).toBe('1,000,000')
  })

  it('handles negative prices', () => {
    expect(formatPrice(-0.2345)).toBe('-0.2345')
    expect(formatPrice(-1234.56)).toBe('-1,234.56')
  })
})

describe('formatPriceUSD', () => {
  it('adds $ prefix to formatPrice output', () => {
    expect(formatPriceUSD(0)).toBe('$0.00')
    expect(formatPriceUSD(0.2345)).toBe('$0.2345')
    expect(formatPriceUSD(1234.56)).toBe('$1,234.56')
    expect(formatPriceUSD(10000)).toBe('$10,000')
  })
})

describe('formatPercent', () => {
  it('formats positive with sign', () => {
    expect(formatPercent(5.123)).toBe('+5.12%')
    expect(formatPercent(0)).toBe('+0.00%')
  })

  it('formats negative with sign', () => {
    expect(formatPercent(-3.456)).toBe('-3.46%')
  })

  it('respects decimal places', () => {
    expect(formatPercent(5.123, 1)).toBe('+5.1%')
    expect(formatPercent(5.123, 0)).toBe('+5%')
  })
})

describe('formatCompact', () => {
  it('formats billions', () => {
    expect(formatCompact(1_500_000_000)).toBe('1.5B')
  })

  it('formats millions', () => {
    expect(formatCompact(2_300_000)).toBe('2.3M')
  })

  it('formats thousands', () => {
    expect(formatCompact(45_600)).toBe('45.6K')
  })

  it('formats small numbers as-is', () => {
    expect(formatCompact(999)).toBe('999')
    expect(formatCompact(0)).toBe('0')
  })
})
