import { describe, expect, it } from 'vitest'
import { normalizeChainId, normalizeTimestamp } from '../normalize'

// Fixture-backed, no network. Covers the measured 2026-10-07 defects:
// chain-label divergence (sol vs solana) and seconds-vs-ms createdAt.

const NOW = new Date('2026-10-07T00:00:00Z').getTime()

describe('normalizeChainId', () => {
  it('maps measured short labels to canonical chains', () => {
    expect(normalizeChainId('SOL')).toBe('solana')
    expect(normalizeChainId('sol')).toBe('solana')
    expect(normalizeChainId('ETH')).toBe('ethereum')
    expect(normalizeChainId('eth')).toBe('ethereum')
    expect(normalizeChainId('BSC')).toBe('binance-smart-chain')
    expect(normalizeChainId('bsc')).toBe('binance-smart-chain')
    expect(normalizeChainId('BASE')).toBe('base')
    expect(normalizeChainId('bnb')).toBe('binance-smart-chain')
    expect(normalizeChainId('blastr')).toBe('blast')
  })

  it('maps numeric upstream chain ids', () => {
    expect(normalizeChainId(56)).toBe('binance-smart-chain')
    expect(normalizeChainId(1)).toBe('ethereum')
    expect(normalizeChainId(8453)).toBe('base')
    expect(normalizeChainId(501)).toBe('solana')
  })

  it('lowercases and passes through canonical labels', () => {
    expect(normalizeChainId('solana')).toBe('solana')
    expect(normalizeChainId('Solana')).toBe('solana')
    expect(normalizeChainId('ethereum')).toBe('ethereum')
    expect(normalizeChainId('base')).toBe('base')
    expect(normalizeChainId('arbitrum')).toBe('arbitrum')
    expect(normalizeChainId('robinhood')).toBe('robinhood')
  })

  it('returns empty string for missing input', () => {
    expect(normalizeChainId(null)).toBe('')
    expect(normalizeChainId(undefined)).toBe('')
    expect(normalizeChainId('')).toBe('')
  })
})

describe('normalizeTimestamp', () => {
  it('treats values < 1e12 as seconds', () => {
    // bitget issue_date arrives in seconds on some rows
    expect(normalizeTimestamp(1788000000, NOW)).toBe(1788000000 * 1000)
    expect(normalizeTimestamp('1788000000', NOW)).toBe(1788000000 * 1000)
  })

  it('passes through millisecond values', () => {
    expect(normalizeTimestamp(1788000000000, NOW)).toBe(1788000000000)
    expect(normalizeTimestamp('1788000000000', NOW)).toBe(1788000000000)
  })

  it('parses ISO date strings', () => {
    const iso = '2026-08-01T00:00:00.000Z'
    expect(normalizeTimestamp(iso, NOW)).toBe(Date.parse(iso))
  })

  it('rejects absurd futures beyond now+1y', () => {
    const farFuture = NOW + 2 * 365 * 24 * 60 * 60 * 1000
    expect(normalizeTimestamp(farFuture, NOW)).toBeNull()
  })

  it('returns null for missing or garbage input', () => {
    expect(normalizeTimestamp(null, NOW)).toBeNull()
    expect(normalizeTimestamp(undefined, NOW)).toBeNull()
    expect(normalizeTimestamp('', NOW)).toBeNull()
    expect(normalizeTimestamp(0, NOW)).toBeNull()
    expect(normalizeTimestamp(-5, NOW)).toBeNull()
    expect(normalizeTimestamp('not-a-date', NOW)).toBeNull()
    expect(normalizeTimestamp(NaN, NOW)).toBeNull()
  })
})
