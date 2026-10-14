// ─────────────────────────────────────────────────────────────
// Solpump meme platform discovery tests.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { discoverSolpumpTokens } from '../index'
import * as twitterModule from '../twitter'

beforeEach(() => {
  delete process.env.SOLPUMP_X_ENABLED
  twitterModule.__resetSolpumpXForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  twitterModule.__resetSolpumpXForTests()
})

const MOCK_EVENT: twitterModule.SolpumpTweetEvent = {
  id: 15938590,
  action: 'TWEET',
  originalAction: null,
  tweetId: '2110472588875198617',
  ageSeconds: 8,
  timestamp: 1792010850000,
  timestampStr: '2026-10-14T20:47:30+00:00',
  author: {
    handle: 'bankrbot',
    name: 'bankrbot',
    avatar: 'https://avatar.example.com',
    followers: 118542,
    tags: ['kol'],
  },
  content: { text: 'test', media: [] },
  tokenType: 'CA',
  token: {
    chain: 'SOL',
    symbol: 'ALIENS',
    address: '54WtjBpHawMTJhLdweKfGD2NCFte5VgTK1FwsmydnTU1',
    image: 'https://gmgn.ai/test.webp',
    priceUsd: 0.00002578,
    priceUsdStr: '0.00002578',
    priceUsd1h: 0.00000325,
    priceUsd1hStr: '0.00000325',
    marketCapUsd: 25788,
    marketCapUsdStr: '25788',
  },
  reference: null,
  unfollowTarget: null,
  avatarChange: null,
  bioChange: null,
}

describe('discoverSolpumpTokens', () => {
  it('returns empty when SOLPUMP_X_ENABLED is not true', async () => {
    const fetchSpy = vi.spyOn(twitterModule, 'fetchSolpumpTwitterEvents')

    const result = await discoverSolpumpTokens()

    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('normalizes token-bearing events to MemeAlphaToken', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    vi.spyOn(twitterModule, 'fetchSolpumpTwitterEvents').mockResolvedValue([
      MOCK_EVENT,
      { ...MOCK_EVENT, id: 9999, token: null, tokenType: null }, // no token, should be skipped
    ])

    const result = await discoverSolpumpTokens()

    expect(result).toHaveLength(1)
    const token = result[0]
    expect(token.platform).toBe('solpump')
    expect(token.chain).toBe('solana')
    expect(token.contract).toBe('54WtjBpHawMTJhLdweKfGD2NCFte5VgTK1FwsmydnTU1')
    expect(token.symbol).toBe('ALIENS')
    expect(token.price).toBe(0.00002578)
    expect(token.marketCap).toBe(25788)
    expect(token.provenance?.provider).toBe('solpump')
    expect(token.provenance?.sourceType).toBe('public-api')
  })

  it('deduplicates tokens by contract address', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    vi.spyOn(twitterModule, 'fetchSolpumpTwitterEvents').mockResolvedValue([
      MOCK_EVENT,
      { ...MOCK_EVENT, id: 1111 }, // duplicate address
    ])

    const result = await discoverSolpumpTokens()

    expect(result).toHaveLength(1)
  })

  it('respects limit parameter', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    const event2: twitterModule.SolpumpTweetEvent = {
      ...MOCK_EVENT,
      id: 2222,
      token: {
        ...MOCK_EVENT.token!,
        address: 'different_address_456',
        symbol: 'DIFF',
      },
    }
    vi.spyOn(twitterModule, 'fetchSolpumpTwitterEvents').mockResolvedValue([MOCK_EVENT, event2])

    const result = await discoverSolpumpTokens(1)

    expect(result).toHaveLength(1)
  })

  it('returns empty on fetch error (no crash)', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    vi.spyOn(twitterModule, 'fetchSolpumpTwitterEvents').mockRejectedValue(new Error('network boom'))

    const result = await discoverSolpumpTokens()

    expect(result).toEqual([])
  })
})
