import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/payments/history/route'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }))
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

beforeEach(() => { vi.clearAllMocks() })

it('debug', async () => {
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

  console.log('status:', res.status)
  console.log('body:', JSON.stringify(body, null, 2))
})
