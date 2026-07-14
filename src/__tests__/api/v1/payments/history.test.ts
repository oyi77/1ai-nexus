import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/payments/history/route'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

vi.mock('@/lib/jwt', () => ({
  verifyToken: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    payment: { findMany: vi.fn(), count: vi.fn() },
  },
}))

function validTokenReq(path = '/api/v1/payments/history') {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { authorization: 'Bearer test-token' },
  })
}

function noAuthReq(path = '/api/v1/payments/history') {
  return new NextRequest(`http://localhost:3000${path}`)
}
function cookieAuthReq(path = '/api/v1/payments/history', token = 'cookie-token') {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: `nexus-session=${token}` },
  })
}

describe('GET /api/v1/payments/history', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated payment history', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1', email: 'test@example.com', role: 'pro', plan: 'pro',
    })
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub-1', userId: 'user-1', plan: 'pro', status: 'active',
      startDate: new Date(), endDate: null, canceledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    const pays = [
      { id: 'pay-1', subscriptionId: 'sub-1', amount: 4900, currency: 'USD', status: 'completed' as const, provider: 'stripe', externalId: null, metadata: null, createdAt: new Date('2024-06-01'), updatedAt: new Date('2024-06-01') },
      { id: 'pay-2', subscriptionId: 'sub-1', amount: 4900, currency: 'USD', status: 'completed' as const, provider: 'stripe', externalId: null, metadata: null, createdAt: new Date('2024-06-01'), updatedAt: new Date('2024-06-01') },
    ]
    vi.mocked(prisma.payment.findMany).mockResolvedValue(pays)
    vi.mocked(prisma.payment.count).mockResolvedValue(2)

    const res = await GET(validTokenReq('/api/v1/payments/history?page=1&pageSize=10'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(body.meta).toEqual({ page: 1, pageSize: 10, total: 2, hasMore: false })
    expect(body.error).toBeNull()
    expect(verifyToken).toHaveBeenCalledWith('test-token')
  })

  it('returns empty data when no subscription', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1', email: 'test@example.com', role: 'pro', plan: 'pro',
    })
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)

    const res = await GET(validTokenReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.meta).toEqual({ page: 1, pageSize: 10, total: 0, hasMore: false })
  })

  it('returns empty data when no payments', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1', email: 'test@example.com', role: 'pro', plan: 'pro',
    })
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub-1', userId: 'user-1', plan: 'pro', status: 'active',
      startDate: new Date(), endDate: null, canceledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    vi.mocked(prisma.payment.findMany).mockResolvedValue([])
    vi.mocked(prisma.payment.count).mockResolvedValue(0)

    const res = await GET(validTokenReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.meta).toEqual({ page: 1, pageSize: 10, total: 0, hasMore: false })
  })

  it('rejects missing auth header', async () => {
    const res = await GET(noAuthReq())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Authentication required')
    expect(body.data).toBeNull()
  })

  it('rejects non-Bearer auth header', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/payments/history', {
      headers: { authorization: 'Basic creds' },
    })
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Authentication required')
  })

  it('rejects invalid token', async () => {
    vi.mocked(verifyToken).mockResolvedValue(null)

    const req = new NextRequest('http://localhost:3000/api/v1/payments/history', {
      headers: { authorization: 'Bearer bad-token' },
    })
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Invalid or expired token')
  })

  it('accepts JWT from nexus-session cookie', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1', email: 'test@example.com', role: 'pro', plan: 'pro',
    })
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub-1', userId: 'user-1', plan: 'pro', status: 'active',
      startDate: new Date(), endDate: null, canceledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    vi.mocked(prisma.payment.findMany).mockResolvedValue([])
    vi.mocked(prisma.payment.count).mockResolvedValue(0)

    const res = await GET(cookieAuthReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
  })

  it('filters by status', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1', email: 'test@example.com', role: 'pro', plan: 'pro',
    })
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub-1', userId: 'user-1', plan: 'pro', status: 'active',
      startDate: new Date(), endDate: null, canceledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      { id: 'pay-1', subscriptionId: 'sub-1', amount: 4900, currency: 'USD', status: 'failed', provider: 'stripe', externalId: null, metadata: null, createdAt: new Date('2024-06-01'), updatedAt: new Date('2024-06-01') },
    ])
    vi.mocked(prisma.payment.count).mockResolvedValue(1)

    await GET(validTokenReq('/api/v1/payments/history?status=failed'))

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'failed' }) }),
    )
  })

  it('handles internal errors with 500', async () => {
    vi.mocked(verifyToken).mockRejectedValue(new Error('boom'))

    const res = await GET(validTokenReq())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('Failed to fetch payment history')
  })
})
