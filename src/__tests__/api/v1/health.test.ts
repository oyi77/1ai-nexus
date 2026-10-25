import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const entityCount = vi.fn()
const backtestCount = vi.fn()
const queryRaw = vi.fn()
const ping = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: queryRaw,
    entity: { count: entityCount },
    backtestResult: { count: backtestCount },
  },
}))
vi.mock('@/lib/redis', () => ({ getRedisClient: () => ({ ping }) }))
vi.mock('@/lib/modules/health', () => ({ getAllHealth: () => [] }))
vi.mock('@/lib/conviction/build', () => ({
  peekCachedConviction: () => null,
  getConvictionTtl: () => 25_000,
}))

const { GET } = await import('@/app/api/v1/health/route')

function response(status: number, body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify(body), { status })
}

describe('GET /api/v1/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryRaw.mockResolvedValue([{ '?column?': 1 }])
    ping.mockResolvedValue('PONG')
    entityCount.mockResolvedValue(50)
    backtestCount.mockResolvedValue(0)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith(':4401/health')
      ? response(200, { status: 'ok', streams: 1 })
      : response(200, { status: 'ok', uptime: 1 })))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('treats the canonical 50-entity seed as present', async () => {
    const body = await (await GET()).json()
    expect(body.checks.entities).toBe(50)
    expect(body.checks.dataIntegrity).toBe('ok')
  })

  it('does not degrade aggregate status for informational object checks', async () => {
    const body = await (await GET()).json()
    expect(body.status).toBe('ok')
  })

  it('degrades data integrity only when no entities exist', async () => {
    entityCount.mockResolvedValue(0)
    const body = await (await GET()).json()
    expect(body.checks.dataIntegrity).toBe('degraded')
  })

  it('does not treat an unsuccessful indexer fallback as healthy', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith(':4401/health')) return response(200, { status: 'ok', streams: 1 })
      if (url.endsWith(':4409/health')) throw new Error('timeout')
      return response(404)
    })
    const body = await (await GET()).json()
    expect(body.checks.indexer).toBe('down')
  })
})
