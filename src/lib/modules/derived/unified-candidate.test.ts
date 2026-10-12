import { describe, it, expect } from 'vitest'
import {
  candidateKey,
  categoryFor,
  mergeEvidence,
  resolveCategory,
  mergeCandidates,
  type CandidateEvidence,
} from './unified-candidate'

describe('candidateKey — chain-aware identity', () => {
  it('keeps Solana mint case (base58 is case-sensitive)', () => {
    const a = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'
    const b = '4K3DYJZVZP8EMZWUXBBCJEVWSKKK59S5ICNLY3QRKX6R'
    expect(candidateKey('solana', a)).not.toBe(candidateKey('solana', b))
    expect(candidateKey('solana', a)).toBe(`solana:${a}`)
  })

  it('lowercases EVM addresses (hex checksums are one token)', () => {
    const mixed = '0xAbCdEf0000000000000000000000000000000001'
    expect(candidateKey('ethereum', mixed)).toBe('ethereum:0xabcdef0000000000000000000000000000000001')
  })

  it('treats a 0x contract as EVM even on an odd chain label', () => {
    expect(candidateKey('solana', '0xABC')).toBe('solana:0xabc')
  })

  it('does not merge the same mint across different chains', () => {
    expect(candidateKey('solana', 'ABC')).not.toBe(candidateKey('bsc', 'ABC'))
  })
})

describe('categoryFor — classification comes from the source', () => {
  it('routes kol kind to INFLUENCER', () => {
    expect(categoryFor('call-feed', { kinds: ['kol'] })).toBe('INFLUENCER')
  })
  it('routes whale/smart-money kinds', () => {
    expect(categoryFor('call-feed', { kinds: ['whale'] })).toBe('WHALE_ACTIVITY')
    expect(categoryFor('call-feed', { kinds: ['smart-money'] })).toBe('SMART_MONEY')
  })
  it('marks a wallet-trace row as WHALE_ACTIVITY', () => {
    expect(categoryFor('wallet-trace')).toBe('WHALE_ACTIVITY')
  })
  it('reads graduated/bonding from the source note', () => {
    expect(categoryFor('alph', { note: 'snipe/graduatedList' })).toBe('POST_MIGRATED')
    expect(categoryFor('alphio', { note: 'sort=heat near_graduation' })).toBe('BONDING')
  })
  it('defaults unknown sources to NEW_PAIRS, never invents a bullish class', () => {
    expect(categoryFor('geckoterminal')).toBe('NEW_PAIRS')
  })
})

function ev(over: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return { provider: 'geckoterminal', category: 'NEW_PAIRS', discoveredAt: 1, ...over }
}

describe('mergeEvidence', () => {
  it('unions distinct rows', () => {
    const a = [ev({ provider: 'geckoterminal' })]
    const b = [ev({ provider: 'dexscreener' })]
    expect(mergeEvidence(a, b)).toHaveLength(2)
  })

  it('does not duplicate an identical row', () => {
    const row = ev({ provider: 'dexscreener', discoveredAt: 5 })
    expect(mergeEvidence([row], [row])).toHaveLength(1)
  })

  it('keeps the same provider twice when discovered at different times', () => {
    expect(mergeEvidence([ev({ provider: 'dexscreener', discoveredAt: 1 })], [ev({ provider: 'dexscreener', discoveredAt: 2 })])).toHaveLength(2)
  })

  it('sorts newest first', () => {
    const out = mergeEvidence([ev({ discoveredAt: 1 })], [ev({ provider: 'x', discoveredAt: 9 })])
    expect(out[0].discoveredAt).toBe(9)
  })
})

describe('resolveCategory', () => {
  it('reports MULTI_SOURCE for two distinct providers', () => {
    expect(resolveCategory([ev({ provider: 'gecko' }), ev({ provider: 'dex' })])).toBe('MULTI_SOURCE')
  })
  it('keeps the single category when only one provider saw it', () => {
    expect(resolveCategory([ev({ provider: 'gecko', category: 'BONDING' })])).toBe('BONDING')
  })
  it('never throws on empty evidence', () => {
    expect(resolveCategory([])).toBe('TRENDING')
  })
})

describe('mergeCandidates', () => {
  const base = {
    chain: 'solana',
    contract: 'MINT',
    marketCap: 0,
    liquidity: null as number | null,
    discoveryEvidence: [ev({ provider: 'gecko' })],
  }
  it('fills a numeric gap from the second source, never zeroes a real value', () => {
    const out = mergeCandidates(base, { ...base, marketCap: 250_000, discoveryEvidence: [] })
    expect(out.marketCap).toBe(250_000)
  })
  it('keeps the first real numeric value', () => {
    const out = mergeCandidates({ ...base, marketCap: 100 }, { ...base, marketCap: 900 })
    expect(out.marketCap).toBe(100)
  })
  it('unions evidence across both rows', () => {
    const out = mergeCandidates(base, { ...base, discoveryEvidence: [ev({ provider: 'dexscreener' })] })
    expect(out.discoveryEvidence).toHaveLength(2)
  })
})
