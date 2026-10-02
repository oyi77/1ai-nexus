// ─────────────────────────────────────────────────────────────
// Moby screening surface tests (fixture-backed, no network).
// Shapes mirrored from live web-api.mobyscreener.com/web/api_v2
// probes 2026-09-16 (groups, launchpads, group board, chart, PnL).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listMobyScreenerGroups,
  listMobyLaunchpads,
  listMobyGroupTokens,
  getMobyChart,
  listMobyPnlLeaderboard,
  __resetMobyGroupsCacheForTests,
} from '../moby'

function mockFetchSequence(bodies: Array<{ status: number; body: unknown }>) {
  const queue = [...bodies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = queue.shift() ?? { status: 500, body: {} }
      return new Response(JSON.stringify(next.body), { status: next.status })
    }),
  )
}

beforeEach(() => {
  process.env.MOBY_API_KEY = 'test-privy-jwt'
  delete process.env.MOBY_REFRESH_TOKEN
  process.env.MOBY_SESSION_PATH = '/tmp/moby-test-nonexistent/session.json'
  __resetMobyGroupsCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const GROUPS = {
  groups: [
    {
      id: 'home_majors',
      network: 'solana',
      group_id: 'home_majors',
      name: 'Majors',
      description: 'Trade assets aren’t natively issued on chain — fully wrapped.',
    },
    { group_id: 'home_stables', network: 'solana', name: 'Stablecoins', description: '' },
  ],
}

const LAUNCHPADS = {
  launchpads: [
    { id: 'pump.fun', launchpad_id: 'pump.fun', name: 'Pump.fun' },
    { launchpad_id: 'letsbonk.fun', name: 'Let’s Bonk' },
  ],
}

const GROUP_ENTRY = {
  network: 'solana',
  token_address: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
  token_symbol: 'ZEC',
  token_created: '2025-10-10T20:31:03',
  token_decimals: 8,
  is_new: false,
  safety_tier: 'green',
  price_usd: 42.5,
  market_cap_usd: 1_200_000,
  liquidity_usd: 90_000,
  price_change_percent: { h24: -2.1 },
  volume_usd: { h24: 310_000 },
}

describe('listMobyScreenerGroups', () => {
  it('normalizes id/group_id aliases', async () => {
    mockFetchSequence([{ status: 200, body: GROUPS }])
    const groups = await listMobyScreenerGroups('solana')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ id: 'home_majors', network: 'solana', name: 'Majors' })
    expect(groups[1].id).toBe('home_stables')
  })

  it('caches per-network within 24h', async () => {
    mockFetchSequence([{ status: 200, body: GROUPS }])
    await listMobyScreenerGroups('solana')
    const again = await listMobyScreenerGroups('solana')
    expect(again).toHaveLength(2)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('drops rows without any id', async () => {
    mockFetchSequence([{ status: 200, body: { groups: [{ name: 'Ghost', network: 'solana' }] } }])
    expect(await listMobyScreenerGroups('solana')).toHaveLength(0)
  })
})

describe('listMobyLaunchpads', () => {
  it('normalizes id/launchpad_id aliases', async () => {
    mockFetchSequence([{ status: 200, body: LAUNCHPADS }])
    const pads = await listMobyLaunchpads('solana')
    expect(pads).toHaveLength(2)
    expect(pads[0]).toMatchObject({ id: 'pump.fun', name: 'Pump.fun' })
    expect(pads[1].id).toBe('letsbonk.fun')
  })
})

describe('listMobyGroupTokens', () => {
  it('normalizes group leaderboard entries into token rows', async () => {
    mockFetchSequence([{ status: 200, body: { entries: [GROUP_ENTRY] } }])
    const tokens = await listMobyGroupTokens('solana', 'home_majors', 25)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].platform).toBe('moby')
    expect(tokens[0].symbol).toBe('ZEC')
  })

  it('respects limit and drops null normalizations', async () => {
    mockFetchSequence([{ status: 200, body: { entries: [GROUP_ENTRY, { token_symbol: 'X' }] } }])
    const tokens = await listMobyGroupTokens('solana', 'home_majors', 1)
    expect(tokens).toHaveLength(1)
  })
})

describe('getMobyChart', () => {
  it('maps unixTime/value series', async () => {
    mockFetchSequence([
      { status: 200, body: { data: [{ unixTime: 1790856900, ts: 1790856900, value: 112.9 }] } },
    ])
    const pts = await getMobyChart('solana', 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp')
    expect(pts).toEqual([{ ts: 1790856900, price: 112.9 }])
  })

  it('drops zero-timestamp junk points', async () => {
    mockFetchSequence([
      { status: 200, body: { data: [{ unixTime: 0, value: 1 }, { unixTime: 5, value: 2 }] } },
    ])
    expect(await getMobyChart('solana', 'addr')).toEqual([{ ts: 5, price: 2 }])
  })
})

describe('listMobyPnlLeaderboard', () => {
  it('normalizes trader rows', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          window: '24h',
          entries: [
            {
              rank: 1,
              user_id: '94f5e193-6cb1-47a5-8814-d0b6e844bc6b',
              member_number: 'MOBY-P5O3DYUY',
              display_identifier: '2b9c97',
              pnl: 9206.63,
              twitter_username: 'crypto_shoer',
            },
          ],
        },
      },
    ])
    const rows = await listMobyPnlLeaderboard('24h')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rank: 1, pnl: 9206.63, twitterUsername: 'crypto_shoer' })
  })

  it('drops rows without user_id', async () => {
    mockFetchSequence([{ status: 200, body: { entries: [{ rank: 2, pnl: 5 }] } }])
    expect(await listMobyPnlLeaderboard('24h')).toHaveLength(0)
  })
})
