// ─────────────────────────────────────────────────────────────
// NOWPayments Crypto Payment Provider (via 1ai-payment adapter)
// Routes all calls through 1ai-payment aggregator
// Accept: BTC, ETH, USDT, USDC, SOL, and 100+ cryptos
// ─────────────────────────────────────────────────────────────

import { createHmac } from 'crypto'
import type { PaymentProvider, PaymentRequest, PaymentResponse, WebhookPayload } from './types'

const ONE_AI_PAYMENT_API = process.env.ONE_AI_PAYMENT_URL ?? 'http://localhost:3100/api'
const ONE_AI_PAYMENT_KEY = process.env.ONE_AI_PAYMENT_KEY ?? 'dev-key-1ai-tracker'

// Response types from 1ai-payment
interface OneAiPaymentCreateResponse {
  success: boolean
  data?: {
    payment_url?: string
    gateway_reference?: string
  }
  error?: {
    message?: string
  }
}

interface OneAiPaymentStatusResponse {
  success: boolean
  data?: {
    status?: string
  }
  error?: {
    message?: string
  }
}

/**
 * HTTP client for 1ai-payment API calls.
 * Handles request/response marshaling and error handling.
 */
class OneAiPaymentClient {
  private baseUrl: string
  private apiKey: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async createPayment(orderId: string, amount: number, currency: string): Promise<OneAiPaymentCreateResponse> {
    const url = `${this.baseUrl}/payments`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        gateway: 'nowpayments',
        amount,
        currency,
        project_order_id: orderId,
        callback_url: `${process.env.CALLBACK_URL ?? 'http://localhost:3000'}/api/v1/webhooks/nowpayments`,
      }),
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`1ai-payment POST /payments: ${res.status} ${error}`)
    }

    return res.json() as Promise<OneAiPaymentCreateResponse>
  }

  async getPaymentStatus(orderId: string): Promise<OneAiPaymentStatusResponse> {
    const url = `${this.baseUrl}/payments/${orderId}`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`1ai-payment GET /payments/${orderId}: ${res.status} ${error}`)
    }

    return res.json() as Promise<OneAiPaymentStatusResponse>
  }
}

export class NowPaymentsProvider implements PaymentProvider {
  name = 'nowpayments'
  private client: OneAiPaymentClient
  private ipnSecret: string

  constructor() {
    this.client = new OneAiPaymentClient(ONE_AI_PAYMENT_API, ONE_AI_PAYMENT_KEY)
    this.ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET ?? ''
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResponse> {
    try {
      const response = await this.client.createPayment(
        req.orderId,
        req.amount,
        req.currency
      )

      if (!response.success || !response.data?.payment_url) {
        return {
          success: false,
          error: response.error?.message ?? '1ai-payment creation failed',
        }
      }

      return {
        success: true,
        paymentUrl: response.data.payment_url,
        paymentId: response.data.gateway_reference,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: `Payment creation failed: ${message}` }
    }
  }

  verifyWebhook(headers: Record<string, string>, body: string): WebhookPayload | null {
    // Verify with our IPN secret for backward compatibility
    const signature = headers['x-nowpayments-sig'] ?? ''
    const expected = createHmac('sha512', this.ipnSecret)
      .update(body)
      .digest('hex')

    if (signature !== expected) return null

    let data: unknown
    try {
      data = JSON.parse(body)
    } catch {
      return null
    }

    // Validate webhook payload shape
    if (
      !data ||
      typeof data !== 'object' ||
      !('order_id' in data) ||
      !('payment_status' in data) ||
      !('price_amount' in data) ||
      !('price_currency' in data)
    ) {
      return null
    }

    const payload = data as Record<string, unknown>
    const orderId = typeof payload.order_id === 'string' ? payload.order_id : null
    const status = typeof payload.payment_status === 'string' ? payload.payment_status : null
    const amount = typeof payload.price_amount === 'number' ? payload.price_amount : 0
    const currency = typeof payload.price_currency === 'string' ? payload.price_currency : 'USD'

    if (!orderId || !status) return null

    const statusMap: Record<string, WebhookPayload['status']> = {
      finished: 'success',
      confirmed: 'success',
      sending: 'success',
      waiting: 'pending',
      confirming: 'pending',
      expired: 'expired',
      failed: 'failed',
      refunded: 'failed',
    }

    return {
      orderId,
      status: statusMap[status] ?? 'pending',
      amount,
      currency: currency.toUpperCase(),
      timestamp: Date.now(),
      raw: payload,
    }
  }

  async checkStatus(paymentId: string): Promise<{ status: string; paid: boolean }> {
    try {
      const response = await this.client.getPaymentStatus(paymentId)

      const status = response.data?.status ?? 'unknown'
      const paid = ['success', 'completed', 'confirmed'].includes(status.toLowerCase())

      return { status, paid }
    } catch {
      return { status: 'unknown', paid: false }
    }
  }
}
