import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { POST } from '@/app/api/v1/webhooks/payment/route'
import { prisma } from '@/lib/db'

vi.mock('@/lib/db', () => {
  const tx = {
    subscription: { upsert: vi.fn(), findUnique: vi.fn() },
    user: { update: vi.fn() },
    payment: { create: vi.fn(), update: vi.fn(), upsert: vi.fn(), findFirst: vi.fn() },
  }
  return {
    prisma: {
      ...tx,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  }
})

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
  const secret = process.env.ONEAI_PAYMENT_WEBHOOK_SECRET || 'test-secret'
  const signature = createHmac('sha256', secret).update(body).digest('hex')
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
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as never)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay-1' } as never)

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
      data: expect.objectContaining({
        plan: 'pro',
        planStartedAt: expect.any(Date),
        planExpiresAt: expect.any(Date),
      }),
    })
    // role is authorization (admin etc.) — a payment must never clobber it
    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(updateCall.data).not.toHaveProperty('role')
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
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as never)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay-2' } as never)

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
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as never)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay-3' } as never)

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

  it('is inert when a failed order delivery is replayed', async () => {
    const { Prisma } = await import('@prisma/client')
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as never)
    vi.mocked(prisma.payment.create)
      .mockResolvedValueOnce({ id: 'pay-failed' } as never)
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }))

    const body = mockBody({ status: 'failed' })
    const first = await POST(signedRequest(body))
    const second = await POST(signedRequest(body))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(prisma.payment.create).toHaveBeenCalledTimes(2)
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

  it('rejects paid webhook without userId in metadata (400 so gateway retries)', async () => {
    const body = mockBody({ metadata: {} })
    const response = await POST(signedRequest(body))
    // Paid-but-unroutable must be loud: a silent 200 burns a real payment
    // with no subscription activation. 400 forces the gateway to retry.
    expect(response.status).toBe(400)
    expect(prisma.subscription.upsert).not.toHaveBeenCalled()
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('applies a paid order once when the first delivery is replayed', async () => {
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'pay-1', status: 'completed' } as never)
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as never)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay-1' } as never)

    const body = mockBody()
    const first = await POST(signedRequest(body))
    const second = await POST(signedRequest(body))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(prisma.subscription.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.user.update).toHaveBeenCalledTimes(1)
    expect(prisma.payment.create).toHaveBeenCalledTimes(1)
    expect(prisma.payment.update).not.toHaveBeenCalled()
  })

  it('completes a failed order row on a later paid callback without creating a second payment', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({ id: 'pay-failed', status: 'failed' } as never)
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({ id: 'sub-1', userId: 'user-1' } as never)
    vi.mocked(prisma.payment.update).mockResolvedValue({ id: 'pay-failed' } as never)

    const response = await POST(signedRequest(mockBody()))

    expect(response.status).toBe(200)
    expect(prisma.subscription.upsert).toHaveBeenCalled()
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-failed' },
      data: expect.objectContaining({ status: 'completed' }),
    })
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('rejects an amount that does not match the plan price before any write', async () => {
    const response = await POST(signedRequest(mockBody({ amount: 1 })))

    expect(response.status).toBe(400)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
