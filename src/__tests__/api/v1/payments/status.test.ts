import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/v1/payments/[orderId]/route'
import { getPaymentService } from '@/lib/payment-service'
import { verifyToken } from '@/lib/jwt'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/payment-service')
vi.mock('@/lib/jwt')

const mockPaymentService = {
  getPaymentStatus: vi.fn(),
}

// Build a NextRequest with an authenticated session cookie.
function authedRequest(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { cookie: 'nexus-session=valid-jwt' },
  })
}

describe('GET /api/v1/payments/:orderId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPaymentService).mockReturnValue(mockPaymentService as never)
    vi.mocked(verifyToken).mockResolvedValue({ userId: 'user-123' } as never)
  })

  it('should return 401 when unauthenticated', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/v1/payments/order-123'),
      { params: Promise.resolve({ orderId: 'order-123' }) }
    )
    const data = await response.json()
    expect(response.status).toBe(401)
    expect(data).toEqual({ data: null, error: 'Authentication required' })
    expect(mockPaymentService.getPaymentStatus).not.toHaveBeenCalled()
  })

  it('should return 404 when order belongs to another user', async () => {
    mockPaymentService.getPaymentStatus.mockResolvedValue({
      orderId: 'order-999',
      status: 'pending',
      amount: 4900,
      currency: 'USD',
      gateway: 'tripay',
      paymentUrl: 'https://gateway.example.com/pay/999',
      metadata: { userId: 'intruder-user', plan: 'pro' },
      expiresAt: new Date('2026-07-10T13:00:00Z'),
    })

    const response = await GET(
      authedRequest('http://localhost:3000/api/v1/payments/order-999'),
      { params: Promise.resolve({ orderId: 'order-999' }) }
    )
    const data = await response.json()
    expect(response.status).toBe(404)
    expect(data).toEqual({ data: null, error: 'Payment order not found' })
  })

  it('should return pending payment status for own order', async () => {
    mockPaymentService.getPaymentStatus.mockResolvedValue({
      orderId: 'order-123',
      status: 'pending',
      amount: 4900,
      currency: 'USD',
      gateway: 'tripay',
      paymentUrl: 'https://gateway.example.com/pay/123',
      metadata: { userId: 'user-123', plan: 'pro' },
      expiresAt: new Date('2026-07-10T13:00:00Z'),
    })

    const response = await GET(
      authedRequest('http://localhost:3000/api/v1/payments/order-123'),
      { params: Promise.resolve({ orderId: 'order-123' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      data: {
        orderId: 'order-123',
        status: 'pending',
        amount: 4900,
        currency: 'USD',
        gateway: 'tripay',
        paymentUrl: 'https://gateway.example.com/pay/123',
        expiresAt: '2026-07-10T13:00:00.000Z',
      },
      error: null,
    })
    expect(mockPaymentService.getPaymentStatus).toHaveBeenCalledWith('order-123')
  })

  it('should return completed payment status for own order', async () => {
    mockPaymentService.getPaymentStatus.mockResolvedValue({
      orderId: 'order-456',
      status: 'paid',
      amount: 19900,
      currency: 'USD',
      gateway: 'midtrans',
      paymentUrl: null,
      metadata: { userId: 'user-123', plan: 'enterprise' },
      paidAt: new Date('2026-07-09T12:00:00Z'),
    })

    const response = await GET(
      authedRequest('http://localhost:3000/api/v1/payments/order-456'),
      { params: Promise.resolve({ orderId: 'order-456' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      data: {
        orderId: 'order-456',
        status: 'paid',
        amount: 19900,
        currency: 'USD',
        gateway: 'midtrans',
        paymentUrl: null,
        paidAt: '2026-07-09T12:00:00.000Z',
      },
      error: null,
    })
  })

  it('should return failed payment status for own order', async () => {
    mockPaymentService.getPaymentStatus.mockResolvedValue({
      orderId: 'order-789',
      status: 'failed',
      amount: 4900,
      currency: 'USD',
      gateway: 'duitku',
      paymentUrl: null,
      metadata: { userId: 'user-123', plan: 'pro', error: 'Insufficient funds' },
    })

    const response = await GET(
      authedRequest('http://localhost:3000/api/v1/payments/order-789'),
      { params: Promise.resolve({ orderId: 'order-789' }) }
    )
    const data = await response.json()

    expect(data).toEqual({
      data: {
        orderId: 'order-789',
        status: 'failed',
        amount: 4900,
        currency: 'USD',
        gateway: 'duitku',
        paymentUrl: null,
      },
      error: null,
    })
  })

  it('should return 404 for non-existent order', async () => {
    mockPaymentService.getPaymentStatus.mockRejectedValue(
      new Error('Order not found')
    )

    const response = await GET(
      authedRequest('http://localhost:3000/api/v1/payments/order-nonexistent'),
      { params: Promise.resolve({ orderId: 'order-nonexistent' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ data: null, error: 'Payment order not found' })
  })

  it('should handle service errors', async () => {
    mockPaymentService.getPaymentStatus.mockRejectedValue(
      new Error('Service unavailable')
    )

    const response = await GET(
      authedRequest('http://localhost:3000/api/v1/payments/order-error'),
      { params: Promise.resolve({ orderId: 'order-error' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ data: null, error: 'Failed to get payment status' })
  })

  it('should handle missing orderId parameter', async () => {
    const response = await GET(
      authedRequest('http://localhost:3000/api/v1/payments/'),
      { params: Promise.resolve({ orderId: '' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ data: null, error: 'Invalid orderId parameter' })
    expect(mockPaymentService.getPaymentStatus).not.toHaveBeenCalled()
  })
})
