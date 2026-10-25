import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn() }))
vi.mock('@/lib/modules/chain/mempool/intel', () => ({
  fetchMempoolEvents: vi.fn(),
  persistMempoolEvents: vi.fn(),
}))
vi.mock('@/lib/modules/chain/bridge/flows', () => ({
  fetchBridgeStats: vi.fn(),
  fetchBridgeFlows: vi.fn(),
  persistBridgeFlows: vi.fn(),
}))
vi.mock('@/lib/modules/chain/ethereum/staking-queue', () => ({
  fetchStakingQueue: vi.fn(),
  persistStakingFlow: vi.fn(),
}))

const { cacheGet, cacheSet } = await import('@/lib/cache')
const { fetchMempoolEvents, persistMempoolEvents } = await import('@/lib/modules/chain/mempool/intel')
const { fetchBridgeStats, fetchBridgeFlows, persistBridgeFlows } = await import('@/lib/modules/chain/bridge/flows')
const { fetchStakingQueue, persistStakingFlow } = await import('@/lib/modules/chain/ethereum/staking-queue')
const { GET } = await import('@/app/api/v1/onchain-intel/route')

async function payload() {
  const response = await GET(new NextRequest('http://localhost/api/v1/onchain-intel?action=all'))
  return { status: response.status, body: await response.json() }
}

describe('GET /api/v1/onchain-intel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cacheGet).mockResolvedValue(null)
    vi.mocked(cacheSet).mockResolvedValue(undefined)
    vi.mocked(fetchMempoolEvents).mockResolvedValue([])
    vi.mocked(fetchBridgeStats).mockResolvedValue({ bridges: [], totalVolume24h: 0 })
    vi.mocked(fetchBridgeFlows).mockResolvedValue([])
    vi.mocked(fetchStakingQueue).mockResolvedValue({
      asset: 'ETH', entryQueue: 1, exitQueue: 2, netStaked: null,
      entryWaitDays: null, exitWaitDays: null, timestamp: '2026-10-25T00:00:00Z',
    })
    vi.mocked(persistMempoolEvents).mockResolvedValue(0)
    vi.mocked(persistBridgeFlows).mockResolvedValue(0)
    vi.mocked(persistStakingFlow).mockResolvedValue(true)
  })

  it('keeps successful sources when another source fails', async () => {
    vi.mocked(fetchBridgeStats).mockRejectedValue(new Error('bridge down'))
    const { status, body } = await payload()
    expect(status).toBe(200)
    expect(body.data.sources).toEqual({ mempool: 'live', bridge: 'unavailable', bridgeFlows: 'live', staking: 'live' })
    expect(body.data.bridge).toBeNull()
    expect(body.data.staking.entryQueue).toBe(1)
  })

  it('marks cached data stale instead of live after an upstream failure', async () => {
    vi.mocked(cacheGet).mockImplementation(async key => key === 'onchain:bridge'
      ? { bridges: [{ name: 'cached', volume24h: 10, chains: [] }], totalVolume24h: 10 }
      : null)
    vi.mocked(fetchBridgeStats).mockRejectedValue(new Error('bridge down'))
    const { body } = await payload()
    expect(body.data.sources.bridge).toBe('stale')
    expect(body.data.bridge.totalVolume24h).toBe(10)
  })

  it('isolates bridge flows from bridge stats and marks only the failed source unavailable', async () => {
    vi.mocked(fetchBridgeFlows).mockRejectedValue(new Error('flows down'))
    const { status, body } = await payload()
    expect(status).toBe(200)
    expect(body.data.sources).toEqual({ mempool: 'live', bridge: 'live', bridgeFlows: 'unavailable', staking: 'live' })
    expect(body.data.bridge).toEqual({ bridges: [], totalVolume24h: 0 })
    expect(body.data.bridgeFlows).toBeNull()
  })

  it('fails closed when cache reads fail instead of rejecting the whole route', async () => {
    vi.mocked(cacheGet).mockRejectedValue(new Error('cache down'))
    const { status, body } = await payload()
    expect(status).toBe(200)
    expect(body.data.sources.mempool).toBe('live')
  })
})
