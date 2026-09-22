import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    payment: { findUnique: vi.fn(), update: vi.fn() },
    subscription: { update: vi.fn() },
    user: { update: vi.fn() },
  },
}))

vi.mock('@/lib/payment-service', () => ({
  getPaymentService: vi.fn(),
}))

const { requireAdmin } = await import('@/lib/admin-auth')
const { prisma } = await import('@/lib/db')
const { getPaymentService } = await import('@/lib/payment-service')
const { POST } = await import('@/app/api/v1/admin/refund/route')

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/admin/refund', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockRequireAdmin = vi.mocked(requireAdmin)

describe('POST /api/v1/admin/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
  })

  it('rejects non-admin with 403', async () => {
    mockRequireAdmin.mockResolvedValue(null)
    const res = await POST(post({ paymentId: 'p1' }))
    expect(res.status).toBe(403)
  })

  it('requires paymentId with 400', async () => {
    const res = await POST(post({}))
    expect(res.status).toBe(400)
  })

  it('404 on unknown payment', async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null)
    const res = await POST(post({ paymentId: 'nope' }))
    expect(res.status).toBe(404)
  })

  it('409 on already-refunded payment', async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: 'p1',
      status: 'refunded',
    })
    const res = await POST(post({ paymentId: 'p1' }))
    expect(res.status).toBe(409)
  })

  it('400 on non-completed payment', async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: 'p1',
      status: 'failed',
    })
    const res = await POST(post({ paymentId: 'p1' }))
    expect(res.status).toBe(400)
  })

  it('refunds via gateway first, then downgrades locally', async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: 'p1',
      status: 'completed',
      amount: 4900,
      externalId: 'ord_123',
      subscriptionId: 's1',
      subscription: { userId: 'u1', id: 's1' },
    })
    const refundPayment = vi.fn().mockResolvedValue({ id: 'r1', status: 'ok' })
    vi.mocked(getPaymentService).mockReturnValue({ refundPayment } as never)
    const res = await POST(post({ paymentId: 'p1', reason: 'duplicate charge' }))
    expect(res.status).toBe(200)
    // Gateway first.
    expect(refundPayment).toHaveBeenCalledWith('ord_123', 4900, 'duplicate charge')
    // Then local state.
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'refunded' },
    })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'canceled', canceledAt: expect.any(Date) },
    })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { plan: 'free' },
    })
    const body = await res.json()
    expect(body.data.refunded).toBe(true)
  })

  it('502 when gateway refund throws, local state untouched', async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: 'p1',
      status: 'completed',
      amount: 4900,
      externalId: 'ord_123',
      subscriptionId: 's1',
      subscription: { userId: 'u1', id: 's1' },
    })
    vi.mocked(getPaymentService).mockReturnValue({
      refundPayment: vi.fn().mockRejectedValue(new Error('gateway down')),
    } as never)
    const res = await POST(post({ paymentId: 'p1' }))
    expect(res.status).toBe(502)
    expect(prisma.payment.update).not.toHaveBeenCalled()
    expect(prisma.subscription.update).not.toHaveBeenCalled()
  })
})
