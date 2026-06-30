import { describe, expect, it, beforeEach } from 'vitest'
import { scoreToken, resetTokenRegistry, getTokenRegistrySize } from '../score'

beforeEach(() => {
  resetTokenRegistry()
})

describe('Token Scoring Engine (hype score)', () => {
  const baseToken = { address: '0xabc', chain: 'solana', name: 'TestToken', symbol: 'TEST' }
  const now = Date.now()

  it('scores a token with no data at minimum (score >= 0)', () => {
    const result = scoreToken(baseToken, now)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.address).toBe('0xabc')
    expect(result.chain).toBe('solana')
  })

  it('gives 30 points for 10 boosts (3 points per boost)', () => {
    const result = scoreToken({ ...baseToken, boosts: 10 }, now)
    expect(result.score).toBeGreaterThanOrEqual(30)
    expect(result.boosts).toBe(10)
  })

  it('caps boost score at 30', () => {
    const result = scoreToken({ ...baseToken, boosts: 20 }, now)
    expect(result.score).toBeLessThanOrEqual(40) // 30 boost + 10 recency
  })

  it('scores high volume (>1M = +25)', () => {
    const result = scoreToken({ ...baseToken, volume24h: 2_000_000 }, now)
    expect(result.score).toBeGreaterThanOrEqual(25)
  })

  it('scores medium volume (>100K = +20)', () => {
    const result = scoreToken({ ...baseToken, volume24h: 500_000 }, now)
    expect(result.score).toBeGreaterThanOrEqual(20)
  })

  it('scores low volume (>10K = +10)', () => {
    const result = scoreToken({ ...baseToken, volume24h: 50_000 }, now)
    expect(result.score).toBeGreaterThanOrEqual(10)
  })

  it('assigns low risk for score >= 70', () => {
    const result = scoreToken({
      ...baseToken,
      boosts: 15,
      volume24h: 2_000_000,
      liquidity: 600_000,
      fdv: 20_000_000,
      swapCount: 5,
    }, now)
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.risk).toBe('low')
  })

  it('assigns medium risk for score 40-69', () => {
    const result = scoreToken({
      ...baseToken,
      boosts: 5,
      volume24h: 150_000,
      liquidity: 60_000,
    }, now)
    expect(result.score).toBeGreaterThanOrEqual(40)
    expect(result.score).toBeLessThan(70)
    expect(result.risk).toBe('medium')
  })

  it('assigns high risk for score 20-39', () => {
    const result = scoreToken({ ...baseToken, address: '0xhigh', boosts: 8 }, now)
    expect(result.score).toBeGreaterThanOrEqual(20)
    expect(result.score).toBeLessThan(40)
    expect(result.risk).toBe('high')
  })

  it('assigns extreme risk for score < 20', () => {
    const result = scoreToken({ ...baseToken, address: '0xextreme' }, now)
    expect(result.score).toBeLessThan(20)
    expect(result.risk).toBe('extreme')
  })

  it('scores boosts+volume: 2 boosts=6, recency=10 => 16', () => {
    const result = scoreToken({ ...baseToken, address: '0xcalc', boosts: 2, volume24h: 1_000 }, now)
    expect(result.score).toBe(16)
  })

  it('penalizes old tokens (>4 hours)', () => {
    const fiveHoursAgo = now - 5 * 3_600_000
    scoreToken({ ...baseToken, address: '0xold',
      boosts: 10, volume24h: 2_000_000, liquidity: 600_000,
    }, fiveHoursAgo)
    const oldToken = scoreToken({ ...baseToken, address: '0xold', boosts: 10 }, now)

    const freshToken = scoreToken({ ...baseToken, address: '0xfresh',
      boosts: 10, volume24h: 2_000_000, liquidity: 600_000,
    }, now)

    expect(oldToken.score).toBeLessThan(freshToken.score)
  })

  it('severely penalizes very old tokens (>24 hours)', () => {
    const yesterday = now - 25 * 3_600_000
    scoreToken({ ...baseToken, address: '0xveryold',
      boosts: 15, volume24h: 2_000_000, liquidity: 600_000, fdv: 20_000_000,
    }, yesterday)
    const oldToken = scoreToken({ ...baseToken, address: '0xveryold', boosts: 15 }, now)
    expect(oldToken.score).toBeLessThan(40)
  })

  it('adds swap count (2 pts/swap, max 10)', () => {
    const r5 = scoreToken({ ...baseToken, address: '0xswap5', swapCount: 5 }, now)
    const r0 = scoreToken({ ...baseToken, address: '0xswap0', swapCount: 0 }, now)
    expect(r5.score).toBeGreaterThan(r0.score)
  })

  it('updates existing token and maintains registry', () => {
    expect(getTokenRegistrySize()).toBe(0)
    scoreToken(baseToken, now)
    expect(getTokenRegistrySize()).toBe(1)
    const updated = scoreToken({ address: '0xabc', chain: 'solana', boosts: 5 }, now)
    expect(getTokenRegistrySize()).toBe(1)
    expect(updated.boosts).toBe(5)
  })

  it('caps score at 100', () => {
    const result = scoreToken({
      ...baseToken,
      boosts: 100, volume24h: 100_000_000, liquidity: 50_000_000,
      fdv: 1_000_000_000, swapCount: 100,
    }, now)
    expect(result.score).toBe(100)
  })

  it('merges sources from multiple updates', () => {
    scoreToken({ ...baseToken, sources: ['dexscreener'] }, now)
    const result = scoreToken({ ...baseToken, sources: ['pumpfun'] }, now)
    expect(result.sources).toContain('dexscreener')
    expect(result.sources).toContain('pumpfun')
  })

  it('persists name across updates', () => {
    scoreToken({ ...baseToken, name: 'MoonToken', symbol: 'MOON' }, now)
    const result = scoreToken({ address: '0xabc', chain: 'solana', boosts: 5 }, now)
    expect(result.name).toBe('MoonToken')
    expect(result.symbol).toBe('MOON')
  })
})