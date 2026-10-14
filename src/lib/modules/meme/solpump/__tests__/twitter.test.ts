// ─────────────────────────────────────────────────────────────
// Solpump X/Twitter adapter unit tests (fixture-backed, no network).
// Shapes mirrored from live trade.solpump.io/api/v2/twitter/events
// probes 2026-10-15 (160 events across 8 pages).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  fetchSolpumpTwitterEvents,
  parseEventsResponse,
  extractTokenMentions,
  __resetSolpumpXForTests,
  type SolpumpTweetEvent,
} from '../twitter'

// ── Helpers ──

function mockFetchSequence(bodies: Array<{ status: number; body: unknown }>) {
  const queue = [...bodies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = queue.shift() ?? { status: 500, body: {} }
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

beforeEach(() => {
  delete process.env.SOLPUMP_X_ENABLED
  delete process.env.SOLPUMP_X_SESSION
  __resetSolpumpXForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetSolpumpXForTests()
})

// ── Realistic fixtures (derived from live probe 2026-10-15) ──

const TOKEN_OBJECT = {
  chain: 'SOL',
  symbol: 'ALIENS',
  address: '54WtjBpHawMTJhLdweKfGD2NCFte5VgTK1FwsmydnTU1',
  image: 'https://gmgn.ai/external-res/5ee0e83caac089d91444495b02c28816_v2.webp',
  priceUsd: 2.578869e-05,
  priceUsdStr: '0.00002578869',
  priceUsd1h: 3.253252e-06,
  priceUsd1hStr: '0.0000032532521',
  marketCapUsd: 25788.69,
  marketCapUsdStr: '25788.69',
}

const EVENT_WITH_TOKEN: SolpumpTweetEvent = {
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
    avatar: 'https://pbs.twimg.com/profile_images/2082476759392698368/LTB7_hF6_400x400.jpg',
    followers: 118542,
    tags: ['kol', 'featured'],
  },
  content: { text: 'just bought some $ALIENS', media: [] },
  tokenType: 'CA',
  token: TOKEN_OBJECT,
  reference: null,
  unfollowTarget: null,
  avatarChange: null,
  bioChange: null,
}

const EVENT_WITHOUT_TOKEN: SolpumpTweetEvent = {
  id: 15938599,
  action: 'REPLY',
  originalAction: null,
  tweetId: '2110472616419168719',
  ageSeconds: 1,
  timestamp: 1792010857000,
  timestampStr: '2026-10-14T20:47:37+00:00',
  author: {
    handle: 'Blonskr',
    name: 'Blonskr',
    avatar: 'https://pbs.twimg.com/profile_images/2062077363723337729/yCihMpkJ_400x400.jpg',
    followers: 107294,
    tags: ['kol'],
  },
  content: { text: '的确适合！！！！', media: [] },
  tokenType: null,
  token: null,
  reference: {
    tweetId: '2110370354829176890',
    authorHandle: 'NatalieHol6220',
    authorName: 'William.BEM',
    authorAvatar: 'https://pbs.twimg.com/profile_images/2108804395500781568/OtJkZQ98_400x400.jpg',
    authorFollowers: 564,
    text: '这件衣服不错',
    media: [{ type: 'IMAGE', url: 'https://pbs.twimg.com/media/HUmKM90aYAAKCOY.jpg' }],
    type: 'REPLIED_TO',
    reference: null,
  },
  unfollowTarget: null,
  avatarChange: null,
  bioChange: null,
}

const SECOND_TOKEN_EVENT: SolpumpTweetEvent = {
  ...EVENT_WITH_TOKEN,
  id: 15938591,
  tweetId: '2110472588875198618',
  token: {
    ...TOKEN_OBJECT,
    symbol: 'FeeSwitch',
    address: '4Qsh4VqshszkbmMUeBT3PxbYc6ogYZMVCuQ2njrdpump',
    chain: 'SOL',
    priceUsd: 4.646571e-05,
    marketCapUsd: 46465.71,
  },
  author: {
    ...EVENT_WITH_TOKEN.author,
    handle: 'mikethree',
    followers: 43744,
  },
}

const PAGE_RESPONSE = (events: SolpumpTweetEvent[], nextCursor: string | null) => ({
  events,
  cursor: '.current',
  nextCursor,
})

// ── Tests ──

describe('fetchSolpumpTwitterEvents', () => {
  it('disabled: returns empty array and does not call fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchSolpumpTwitterEvents({ limit: 10 })

    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('enabled: parses token-bearing events correctly', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    __resetSolpumpXForTests()

    mockFetchSequence([
      {
        status: 200,
        body: PAGE_RESPONSE([EVENT_WITH_TOKEN, EVENT_WITHOUT_TOKEN], null),
      },
    ])

    const result = await fetchSolpumpTwitterEvents({ limit: 10 })

    expect(result).toHaveLength(2)
    expect(result[0].token).toEqual(TOKEN_OBJECT)
    expect(result[0].tokenType).toBe('CA')
    expect(result[1].token).toBeNull()
    expect(result[1].tokenType).toBeNull()
  })

  it('network error: returns empty array, no throw', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    __resetSolpumpXForTests()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const result = await fetchSolpumpTwitterEvents({ limit: 10 })

    expect(result).toEqual([])
  })

  it('non-200 response: returns empty array, no throw', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    __resetSolpumpXForTests()

    mockFetchSequence([{ status: 403, body: { error: 'forbidden' } }])

    const result = await fetchSolpumpTwitterEvents({ limit: 10 })

    expect(result).toEqual([])
  })

  it('malformed JSON body: returns empty array, no throw', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    __resetSolpumpXForTests()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('not json at all', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await fetchSolpumpTwitterEvents({ limit: 10 })

    expect(result).toEqual([])
  })

  it('paginates via nextCursor until limit reached', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    __resetSolpumpXForTests()

    const page1Events = Array.from({ length: 20 }, (_, i) => ({
      ...EVENT_WITHOUT_TOKEN,
      id: 1000 + i,
      tweetId: String(2000 + i),
    }))

    mockFetchSequence([
      { status: 200, body: PAGE_RESPONSE(page1Events, '.nextPage2') },
      {
        status: 200,
        body: PAGE_RESPONSE(
          [{ ...EVENT_WITH_TOKEN, id: 1020 }],
          null,
        ),
      },
    ])

    const result = await fetchSolpumpTwitterEvents({ limit: 25 })

    expect(result).toHaveLength(21) // 20 from page 1 + 1 from page 2
    expect(result[20].token).toEqual(TOKEN_OBJECT)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops at empty events page', async () => {
    process.env.SOLPUMP_X_ENABLED = 'true'
    __resetSolpumpXForTests()

    mockFetchSequence([
      { status: 200, body: PAGE_RESPONSE([EVENT_WITHOUT_TOKEN], '.nextPage2') },
      { status: 200, body: PAGE_RESPONSE([], null) },
    ])

    const result = await fetchSolpumpTwitterEvents({ limit: 50 })

    expect(result).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('parseEventsResponse', () => {
  it('parses a valid response body', () => {
    const body = {
      events: [EVENT_WITH_TOKEN],
      cursor: '.abc',
      nextCursor: '.def',
    }

    const result = parseEventsResponse(body)

    expect(result.events).toHaveLength(1)
    expect(result.cursor).toBe('.abc')
    expect(result.nextCursor).toBe('.def')
  })

  it('returns empty for null body', () => {
    expect(parseEventsResponse(null)).toEqual({ events: [], cursor: null, nextCursor: null })
  })

  it('returns empty for non-object body', () => {
    expect(parseEventsResponse('string')).toEqual({ events: [], cursor: null, nextCursor: null })
  })

  it('returns empty events for body without events array', () => {
    expect(parseEventsResponse({ foo: 'bar' })).toEqual({ events: [], cursor: null, nextCursor: null })
  })
})

describe('extractTokenMentions', () => {
  it('aggregates mentions by token address', () => {
    // Two events for the same token (same address, different authors) + one without token
    const events: SolpumpTweetEvent[] = [
      EVENT_WITH_TOKEN,
      { ...EVENT_WITH_TOKEN, id: 999, author: { ...EVENT_WITH_TOKEN.author, handle: 'otherUser', followers: 5000 } },
      EVENT_WITHOUT_TOKEN,
      SECOND_TOKEN_EVENT,
    ]

    const map = extractTokenMentions(events)

    expect(map.size).toBe(2)

    const aliens = map.get('54WtjBpHawMTJhLdweKfGD2NCFte5VgTK1FwsmydnTU1')!
    expect(aliens.mentions).toBe(2)
    expect(aliens.authors.size).toBe(2)
    expect(aliens.authors.has('bankrbot')).toBe(true)
    expect(aliens.authors.has('otherUser')).toBe(true)
    expect(aliens.engagement).toBe(118542 + 5000)
    expect(aliens.token.symbol).toBe('ALIENS')

    const fee = map.get('4Qsh4VqshszkbmMUeBT3PxbYc6ogYZMVCuQ2njrdpump')!
    expect(fee.mentions).toBe(1)
    expect(fee.token.symbol).toBe('FeeSwitch')
  })

  it('returns empty map for events without any tokens', () => {
    const map = extractTokenMentions([EVENT_WITHOUT_TOKEN])
    expect(map.size).toBe(0)
  })

  it('returns empty map for empty input', () => {
    expect(extractTokenMentions([]).size).toBe(0)
  })
})
