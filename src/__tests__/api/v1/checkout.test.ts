import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/v1/checkout/route'
import { PaymentService, getPaymentService } from '@/lib/payment-service'
import { verifyToken } from '@/lib/jwt'

// Mock dependencies
vi.mock('@/lib/payment-service')
vi.mock('@/lib/jwt')

const mockPaymentService = {
  createSubscriptionPayment: vi.fn(),
}

describe('POST /api/v1/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPaymentService).mockReturnValue(mockPaymentService as unknown as PaymentService)
  })

  it('should create checkout session for authenticated pro user', async () => {
    // Mock JWT verification
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-123',
      email: 'test@example.com',
      role: 'free',
      plan: 'free',
    })

    // Mock payment service response
    mockPaymentService.createSubscriptionPayment.mockResolvedValue({
      orderId: 'order-123',
      status: 'pending',
      amount: 4900,
      currency: 'USD',
      gateway: 'tripay',
      paymentUrl: 'https://gateway.example.com/pay/123',
      metadata: { userId: 'user-123', plan: 'pro' },
    })

    // Create request with JWT
    const request = new Request('http://localhost:3000/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer valid-jwt-token',
      },
      body: JSON.stringify({ plan: 'pro' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      orderId: 'order-123',
      paymentUrl: 'https://gateway.example.com/pay/123',
      amount: 4900,
      currency: 'USD',
    })

    expect(mockPaymentService.createSubscriptionPayment).toHaveBeenCalledWith({
      userId: 'user-123',
      plan: 'pro',
      amount: 4900,
      currency: 'USD',
      gateway: 'midtrans',
      customerEmail: 'test@example.com',
      returnUrl: 'http://localhost:4400/account/payments',
      cancelUrl: 'http://localhost:4400/checkout',
    })
  })

  it('should create checkout session for guest enterprise user', async () => {
    // Mock payment service response
    mockPaymentService.createSubscriptionPayment.mockResolvedValue({
      orderId: 'order-456',
      status: 'pending',
      amount: 19900,
      currency: 'USD',
      gateway: 'midtrans',
      paymentUrl: 'https://gateway.example.com/pay/456',
      metadata: { plan: 'enterprise', email: 'guest@example.com' },
    })

    // Create request without JWT (guest checkout)
    const request = new Request('http://localhost:3000/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan: 'enterprise',
        customerEmail: 'guest@example.com',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      orderId: 'order-456',
      paymentUrl: 'https://gateway.example.com/pay/456',
      amount: 19900,
      currency: 'USD',
    })

    expect(mockPaymentService.createSubscriptionPayment).toHaveBeenCalledWith({
      userId: 'guest',
      plan: 'enterprise',
      amount: 19900,
      currency: 'USD',
      gateway: 'midtrans',
      customerEmail: 'guest@example.com',
      returnUrl: 'http://localhost:4400/account/payments',
      cancelUrl: 'http://localhost:4400/checkout',
    })
  })

  it('should reject invalid plan', async () => {
    const request = new Request('http://localhost:3000/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan: 'invalid-plan' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid plan. Must be pro or enterprise')
    expect(mockPaymentService.createSubscriptionPayment).not.toHaveBeenCalled()
  })

  it('should reject missing plan', async () => {
    const request = new Request('http://localhost:3000/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Plan is required')
    expect(mockPaymentService.createSubscriptionPayment).not.toHaveBeenCalled()
  })

  it('should reject guest checkout without email', async () => {
    const request = new Request('http://localhost:3000/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan: 'pro' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Email required for guest checkout')
    expect(mockPaymentService.createSubscriptionPayment).not.toHaveBeenCalled()
  })

  it('should handle payment service errors', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-123',
      email: 'test@example.com',
      role: 'free',
      plan: 'free',
    })

    mockPaymentService.createSubscriptionPayment.mockRejectedValue(
      new Error('Gateway unavailable')
    )

    const request = new Request('http://localhost:3000/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer valid-jwt-token',
      },
      body: JSON.stringify({ plan: 'pro' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Gateway unavailable')
  })

  it('should handle malformed JSON body', async () => {
    const request = new Request('http://localhost:3000/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: 'invalid-json',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Unexpected token \'i\', "invalid-json" is not valid JSON')
    expect(mockPaymentService.createSubscriptionPayment).not.toHaveBeenCalled()
  })
})
