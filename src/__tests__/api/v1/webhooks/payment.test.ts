import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/v1/webhooks/payment/route'
import { prisma } from '@/lib/db'

vi.mock('@/lib/db', () => ({
  prisma: {
    subscription: { upsert: vi.fn(), findUnique: vi.fn() },
    user: { update: vi.fn() },
    payment: { create: vi.fn() },
  },
}))

const mockBody = (overrides = {}) => JSON.stringify({
  order_id: 'ord_123',
  status: 'paid',
  gateway: 'midtrans',
  amount: 4900,
  currency: 'USD',
  metadata: { userId: 'user-1', plan: 'pro' },
  ...overrides,
})

function signedRequest(body: string) {
  const crypto = require('crypto')
  const secret = process.env.ONEAI_PAYMENT_WEBHOOK_SECRET || 'test-secret'
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return new Request('http://localhost:3000/api/v1/webhooks/payment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': signature,
    },
    body,
  })
}

describe('POST /api/v1/webhooks/payment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ONEAI_PAYMENT_WEBHOOK_SECRET = 'test-secret'
  })

  it('creates subscription and payment on paid webhook', async () => {
    const sub = { id: 'sub-1', userId: 'user-1' }
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as any)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay-1' } as any)

    const body = mockBody()
    const response = await POST(signedRequest(body))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ received: true })
    expect(prisma.subscription.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: expect.objectContaining({ plan: 'pro', status: 'active' }),
      create: expect.objectContaining({ userId: 'user-1', plan: 'pro', status: 'active' }),
    })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: 'pro' },
    })
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'sub-1',
        amount: 4900,
        currency: 'USD',
        status: 'completed',
        provider: 'midtrans',
        externalId: 'ord_123',
      }),
    })
  })

  it('records failed payment when status is failed', async () => {
    const sub = { id: 'sub-1', userId: 'user-1' }
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as any)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay-2' } as any)

    const body = mockBody({ status: 'failed' })
    const response = await POST(signedRequest(body))

    expect(response.status).toBe(200)
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'sub-1',
        amount: 4900,
        status: 'failed',
        provider: 'midtrans',
        externalId: 'ord_123',
      }),
    })
  })

  it('records failed payment when status is expired', async () => {
    const sub = { id: 'sub-1', userId: 'user-1' }
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as any)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay-3' } as any)

    const body = mockBody({ status: 'expired' })
    const response = await POST(signedRequest(body))

    expect(response.status).toBe(200)
    expect(prisma.payment.create).toHaveBeenCalled()
  })

  it('skips payment creation on failed when user has no subscription', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)

    const body = mockBody({ status: 'failed' })
    const response = await POST(signedRequest(body))

    expect(response.status).toBe(200)
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('returns 503 when webhook secret is missing', async () => {
    delete process.env.ONEAI_PAYMENT_WEBHOOK_SECRET
    const body = mockBody()
    const req = new Request('http://localhost:3000/api/v1/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-signature': 'sig' },
      body,
    })
    const response = await POST(req)
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toContain('not configured')
  })

  it('rejects missing signature header', async () => {
    const body = mockBody()
    const req = new Request('http://localhost:3000/api/v1/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const response = await POST(req)
    expect(response.status).toBe(400)
  })

  it('rejects invalid signature', async () => {
    const body = mockBody()
    const req = new Request('http://localhost:3000/api/v1/webhooks/payment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'bad-signature',
      },
      body,
    })
    const response = await POST(req)
    expect(response.status).toBe(401)
  })

  it('ignores paid webhook without userId in metadata', async () => {
    const body = mockBody({ metadata: {} })
    const response = await POST(signedRequest(body))
    expect(response.status).toBe(200)
    expect(prisma.subscription.upsert).not.toHaveBeenCalled()
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })
})
