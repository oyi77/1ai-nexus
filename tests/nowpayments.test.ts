import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NowPaymentsProvider } from '@/lib/payments/nowpayments'
import type { PaymentRequest } from '@/lib/payments/types'

// Mock fetch globally
global.fetch = vi.fn()

describe('NowPaymentsProvider (1ai-payment adapter)', () => {
  let provider: NowPaymentsProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new NowPaymentsProvider()
    process.env.ONE_AI_PAYMENT_URL = 'http://localhost:3100/api'
    process.env.ONE_AI_PAYMENT_KEY = 'test-key'
    process.env.NOWPAYMENTS_IPN_SECRET = 'test-secret'
  })

  describe('createPayment', () => {
    it('should return success with payment URL from 1ai-payment', async () => {
      const mockResponse = {
        success: true,
        data: {
          payment_url: 'https://example.com/payment/123',
          gateway_reference: 'np-ref-456',
        },
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const req: PaymentRequest = {
        orderId: 'order-123',
        amount: 100000,
        currency: 'IDR',
        description: 'Test payment',
        customerEmail: 'test@example.com',
      }

      const result = await provider.createPayment(req)

      expect(result.success).toBe(true)
      expect(result.paymentUrl).toBe('https://example.com/payment/123')
      expect(result.paymentId).toBe('np-ref-456')
    })

    it('should return error when 1ai-payment fails', async () => {
      const mockResponse = {
        success: false,
        error: { message: 'Gateway error' },
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const req: PaymentRequest = {
        orderId: 'order-123',
        amount: 100000,
        currency: 'IDR',
        description: 'Test payment',
        customerEmail: 'test@example.com',
      }

      const result = await provider.createPayment(req)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Gateway error')
    })

    it('should handle fetch errors gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))

      const req: PaymentRequest = {
        orderId: 'order-123',
        amount: 100000,
        currency: 'IDR',
        description: 'Test payment',
        customerEmail: 'test@example.com',
      }

      const result = await provider.createPayment(req)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Payment creation failed')
    })
  })

  describe('verifyWebhook', () => {
    it('should verify valid webhook signature', () => {
      const body = JSON.stringify({
        order_id: 'order-123',
        payment_status: 'finished',
        price_amount: 100,
        price_currency: 'USD',
      })

      // Create valid signature
      const { createHmac } = require('crypto')
      const sig = createHmac('sha512', 'test-secret').update(body).digest('hex')

      const headers = { 'x-nowpayments-sig': sig }
      const payload = provider.verifyWebhook(headers, body)

      expect(payload).not.toBeNull()
      expect(payload?.orderId).toBe('order-123')
      expect(payload?.status).toBe('success')
      expect(payload?.amount).toBe(100)
    })

    it('should reject invalid signature', () => {
      const body = JSON.stringify({
        order_id: 'order-123',
        payment_status: 'finished',
        price_amount: 100,
        price_currency: 'USD',
      })

      const headers = { 'x-nowpayments-sig': 'invalid-sig' }
      const payload = provider.verifyWebhook(headers, body)

      expect(payload).toBeNull()
    })

    it('should map payment status correctly', () => {
      const statusCases = [
        { paymentStatus: 'finished', expectedStatus: 'success' },
        { paymentStatus: 'confirmed', expectedStatus: 'success' },
        { paymentStatus: 'waiting', expectedStatus: 'pending' },
        { paymentStatus: 'expired', expectedStatus: 'expired' },
        { paymentStatus: 'failed', expectedStatus: 'failed' },
      ]

      statusCases.forEach(({ paymentStatus, expectedStatus }) => {
        const body = JSON.stringify({
          order_id: 'order-123',
          payment_status: paymentStatus,
          price_amount: 100,
          price_currency: 'USD',
        })

        const { createHmac } = require('crypto')
        const sig = createHmac('sha512', 'test-secret').update(body).digest('hex')

        const headers = { 'x-nowpayments-sig': sig }
        const payload = provider.verifyWebhook(headers, body)

        expect(payload?.status).toBe(expectedStatus)
      })
    })

    it('should reject malformed JSON', () => {
      const headers = { 'x-nowpayments-sig': 'any-sig' }
      const payload = provider.verifyWebhook(headers, 'invalid-json')

      expect(payload).toBeNull()
    })

    it('should reject payload missing required fields', () => {
      const body = JSON.stringify({
        order_id: 'order-123',
        // missing payment_status, price_amount, price_currency
      })

      const { createHmac } = require('crypto')
      const sig = createHmac('sha512', 'test-secret').update(body).digest('hex')

      const headers = { 'x-nowpayments-sig': sig }
      const payload = provider.verifyWebhook(headers, body)

      expect(payload).toBeNull()
    })
  })

  describe('checkStatus', () => {
    it('should return paid status for success payment', async () => {
      const mockResponse = {
        success: true,
        data: { status: 'success' },
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await provider.checkStatus('order-123')

      expect(result.status).toBe('success')
      expect(result.paid).toBe(true)
    })

    it('should return unpaid status for pending payment', async () => {
      const mockResponse = {
        success: true,
        data: { status: 'pending' },
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await provider.checkStatus('order-123')

      expect(result.status).toBe('pending')
      expect(result.paid).toBe(false)
    })

    it('should handle fetch errors gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))

      const result = await provider.checkStatus('order-123')

      expect(result.status).toBe('unknown')
      expect(result.paid).toBe(false)
    })

    it('should recognize paid statuses', async () => {
      const paidStatuses = ['success', 'completed', 'confirmed']

      for (const status of paidStatuses) {
        const mockResponse = {
          success: true,
          data: { status },
        }

        vi.mocked(global.fetch).mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response)

        const result = await provider.checkStatus('order-123')
        expect(result.paid).toBe(true)
      }
    })
  })

  describe('provider interface', () => {
    it('should have correct name', () => {
      expect(provider.name).toBe('nowpayments')
    })

    it('should implement PaymentProvider interface', () => {
      expect(typeof provider.createPayment).toBe('function')
      expect(typeof provider.verifyWebhook).toBe('function')
      expect(typeof provider.checkStatus).toBe('function')
    })
  })
})
