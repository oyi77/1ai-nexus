import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    watchlist: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/jwt', () => ({
  verifyToken: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { verifyToken } = await import('@/lib/jwt')
const { GET, POST, DELETE } = await import('@/app/api/v1/watchlist/route')

function authReq(path: string, init?: Record<string, unknown>): NextRequest {
  const headers: Record<string, string> = {
    authorization: 'Bearer test-token',
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  return new NextRequest(
    `http://localhost:3000${path}`,
    { ...(init as object), headers } as ConstructorParameters<typeof NextRequest>[1],
  )
}

const asUser = () => {
  vi.mocked(verifyToken).mockResolvedValue({
    userId: 'user-1', email: 'test@example.com', role: 'free', plan: 'free',
  })
}

describe('POST /api/v1/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asUser()
  })

  it('upserts a symbol and normalizes case', async () => {
    vi.mocked(prisma.watchlist.upsert).mockResolvedValue({
      id: 'w1', userId: 'user-1', symbol: 'BBCA', market: 'IDX', createdAt: new Date(),
    })
    const res = await POST(authReq('/api/v1/watchlist', {
      method: 'POST', body: JSON.stringify({ symbol: 'bbca', market: 'IDX' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.added).toEqual({ symbol: 'BBCA', market: 'IDX' })
    expect(prisma.watchlist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_symbol_market: { userId: 'user-1', symbol: 'BBCA', market: 'IDX' } },
        create: expect.objectContaining({ symbol: 'BBCA', market: 'IDX' }),
      }),
    )
  })

  it('rejects an invalid market', async () => {
    const res = await POST(authReq('/api/v1/watchlist', {
      method: 'POST', body: JSON.stringify({ symbol: 'BBCA', market: 'STOCKS' }),
    }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(verifyToken).mockResolvedValue(null)
    const res = await POST(authReq('/api/v1/watchlist', {
      method: 'POST', body: JSON.stringify({ symbol: 'BBCA', market: 'IDX' }),
    }))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asUser()
  })

  it('lists the current user watchlist', async () => {
    vi.mocked(prisma.watchlist.findMany).mockResolvedValue([
      { id: 'w1', userId: 'user-1', symbol: 'BBCA', market: 'IDX', createdAt: new Date() },
      { id: 'w2', userId: 'user-1', symbol: 'BTC', market: 'CRYPTO', createdAt: new Date() },
    ])
    const res = await GET(authReq('/api/v1/watchlist'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.watchlist).toHaveLength(2)
    expect(body.data.watchlist[0]).toEqual({ symbol: 'BBCA', market: 'IDX' })
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(verifyToken).mockResolvedValue(null)
    const res = await GET(authReq('/api/v1/watchlist'))
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/v1/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asUser()
  })

  it('removes a symbol from watchlist', async () => {
    vi.mocked(prisma.watchlist.deleteMany).mockResolvedValue({ count: 1 })
    const res = await DELETE(authReq('/api/v1/watchlist?symbol=BBCA&market=IDX'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.removed).toBe(true)
    expect(prisma.watchlist.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', symbol: 'BBCA', market: 'IDX' } }),
    )
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(verifyToken).mockResolvedValue(null)
    const res = await DELETE(authReq('/api/v1/watchlist?symbol=BBCA&market=IDX'))
    expect(res.status).toBe(401)
  })
})
