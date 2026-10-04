import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/modules/meme/moby', () => ({
  getMobyChart: vi.fn(),
  listMobyGroupTokens: vi.fn(),
  listMobyLaunchpads: vi.fn(),
  listMobyPnlLeaderboard: vi.fn(),
  listMobyScreenerGroups: vi.fn(),
}))

const {
  getMobyChart,
  listMobyGroupTokens,
  listMobyLaunchpads,
  listMobyPnlLeaderboard,
  listMobyScreenerGroups,
} = await import('@/lib/modules/meme/moby')
const { GET } = await import('./route')

const mocks = {
  chart: vi.mocked(getMobyChart),
  tokens: vi.mocked(listMobyGroupTokens),
  launchpads: vi.mocked(listMobyLaunchpads),
  pnl: vi.mocked(listMobyPnlLeaderboard),
  groups: vi.mocked(listMobyScreenerGroups),
}

function request(query: string) {
  return new NextRequest(`http://localhost/api/v1/meme/moby?${query}`)
}

async function body(response: Response) {
  return (await response.json()) as { data: unknown; error: string | null }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/meme/moby', () => {
  it('rejects an unknown surface before dispatch', async () => {
    const response = await GET(request('surface=nope'))

    expect(response.status).toBe(400)
    expect(await body(response)).toEqual({
      data: null,
      error: 'surface must be one of: groups, launchpads, tokens, chart, pnl',
    })
    expect(mocks.groups).not.toHaveBeenCalled()
  })

  it('validates required parameters and limits', async () => {
    expect((await GET(request('surface=groups'))).status).toBe(400)
    expect((await GET(request('surface=tokens&network=solana&groupId=group&limit=0'))).status).toBe(400)
    expect(mocks.groups).not.toHaveBeenCalled()
    expect(mocks.tokens).not.toHaveBeenCalled()
  })

  it('dispatches every supported surface with normalized query inputs', async () => {
    mocks.groups.mockResolvedValue([{ id: 'group' } as never])
    mocks.launchpads.mockResolvedValue([{ id: 'pad' } as never])
    mocks.tokens.mockResolvedValue([])
    mocks.chart.mockResolvedValue([])
    mocks.pnl.mockResolvedValue([])

    expect((await GET(request('surface=groups&network=%20solana%20'))).status).toBe(200)
    expect((await GET(request('surface=launchpads&network=base'))).status).toBe(200)
    expect((await GET(request('surface=tokens&network=solana&groupId=g-1&limit=250'))).status).toBe(200)
    expect((await GET(request('surface=chart&chain=solana&contract=abc'))).status).toBe(200)
    expect((await GET(request('surface=pnl&window=7d'))).status).toBe(200)

    expect(mocks.groups).toHaveBeenCalledWith('solana')
    expect(mocks.launchpads).toHaveBeenCalledWith('base')
    expect(mocks.tokens).toHaveBeenCalledWith('solana', 'g-1', 100)
    expect(mocks.chart).toHaveBeenCalledWith('solana', 'abc')
    expect(mocks.pnl).toHaveBeenCalledWith('7d')
  })

  it('rejects invalid PnL windows', async () => {
    const response = await GET(request('surface=pnl&window=30d'))

    expect(response.status).toBe(400)
    expect((await body(response)).error).toBe('window must be 24h or 7d')
    expect(mocks.pnl).not.toHaveBeenCalled()
  })

  it('maps upstream failures to 502 without leaking a raw response', async () => {
    mocks.groups.mockRejectedValue(new Error('401 unauthorized'))

    const response = await GET(request('surface=groups&network=solana'))

    expect(response.status).toBe(502)
    expect((await body(response)).error).toBe('Moby upstream request failed: 401 unauthorized')
  })
})
