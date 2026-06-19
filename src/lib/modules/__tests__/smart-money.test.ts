// ─────────────────────────────────────────────────────────────
// Smart Money Scoring Engine Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { computeScore } from '../ai-signals/nexus-internal'

describe('Smart Money Scoring Engine', () => {
  describe('computeScore()', () => {
    it('returns a score between 0 and 100', () => {
      const result = computeScore({ address: '0x123', chain: 'eth' })
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
    })

    it('returns correct address and chain', () => {
      const result = computeScore({ address: '0xabc', chain: 'sol' })
      expect(result.address).toBe('0xabc')
      expect(result.chain).toBe('sol')
    })

    it('gives score boost for wallet age > 1 year', () => {
      const old = computeScore({
        address: '0x1', chain: 'eth',
        firstSeen: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      })
      const newWallet = computeScore({
        address: '0x2', chain: 'eth',
        firstSeen: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      })
      expect(old.score).toBeGreaterThan(newWallet.score)
      expect(old.signals).toContain('wallet_age>1yr')
    })

    it('gives score boost for high volume', () => {
      const highVol = computeScore({ address: '0x1', chain: 'eth', totalVolume: 5_000_000 })
      const lowVol = computeScore({ address: '0x2', chain: 'eth', totalVolume: 500 })
      expect(highVol.score).toBeGreaterThan(lowVol.score)
      expect(highVol.signals).toContain('volume>$1M')
    })

    it('gives score boost for win rate > 60%', () => {
      const winner = computeScore({ address: '0x1', chain: 'eth', winRate: 0.75 })
      const loser = computeScore({ address: '0x2', chain: 'eth', winRate: 0.3 })
      expect(winner.score).toBeGreaterThan(loser.score)
      expect(winner.signals).toContain('winrate>60%')
    })

    it('gives score boost for entity label', () => {
      const labeled = computeScore({ address: '0x1', chain: 'eth', entityLabel: 'Jump Trading' })
      const unlabeled = computeScore({ address: '0x2', chain: 'eth' })
      expect(labeled.score).toBeGreaterThan(unlabeled.score)
      expect(labeled.signals).toContain('entity:Jump Trading')
    })

    it('categorizes VC entities correctly', () => {
      const result = computeScore({ address: '0x1', chain: 'eth', entityLabel: 'Paradigm VC Fund' })
      expect(result.category).toBe('vc')
    })

    it('categorizes CEX entities correctly', () => {
      const result = computeScore({ address: '0x1', chain: 'eth', entityLabel: 'Binance Exchange' })
      expect(result.category).toBe('cex')
    })

    it('categorizes DeFi entities correctly', () => {
      const result = computeScore({ address: '0x1', chain: 'eth', entityLabel: 'Uniswap DAO' })
      expect(result.category).toBe('defi')
    })

    it('defaults to trader category when no entity label', () => {
      const result = computeScore({ address: '0x1', chain: 'eth' })
      expect(result.category).toBe('trader')
    })

    it('caps score at 100 even with all signals', () => {
      const result = computeScore({
        address: '0x1',
        chain: 'eth',
        firstSeen: new Date(Date.now() - 400 * 86_400_000).toISOString(),
        totalVolume: 10_000_000,
        winRate: 0.9,
        entityLabel: 'Jump Trading',
        avgHoldTime: 30,
        txCount: 5000,
      })
      expect(result.score).toBeLessThanOrEqual(100)
    })

    it('confidence increases with more signals', () => {
      const few = computeScore({ address: '0x1', chain: 'eth' })
      const many = computeScore({
        address: '0x2', chain: 'eth',
        firstSeen: new Date(Date.now() - 400 * 86_400_000).toISOString(),
        totalVolume: 5_000_000,
        winRate: 0.8,
        entityLabel: 'Whale',
      })
      expect(many.confidence).toBeGreaterThan(few.confidence)
    })

    it('gives boost for hold time > 7 days', () => {
      const holder = computeScore({ address: '0x1', chain: 'eth', avgHoldTime: 14 })
      const flipper = computeScore({ address: '0x2', chain: 'eth', avgHoldTime: 0.5 })
      expect(holder.score).toBeGreaterThan(flipper.score)
      expect(holder.signals).toContain('holdtime>7d')
    })
  })
})
