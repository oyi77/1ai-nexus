// ─────────────────────────────────────────────────────────────
// Tripay Payment Gateway Provider
// Indonesian payment: QRIS, VA (BCA, BNI, BRI, Mandiri), Alfamart
// Docs: https://tripay.co.id/developer
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type { PaymentProvider, PaymentRequest, PaymentResponse, WebhookPayload } from './types'

const TRIPAY_API = 'https://tripay.co.id/api'

export class TripayProvider implements PaymentProvider {
  name = 'tripay'
  private apiKey: string
  private privateKey: string
  private merchantCode: string

  constructor() {
    this.apiKey = process.env.TRIPAY_API_KEY ?? ''
    this.privateKey = process.env.TRIPAY_PRIVATE_KEY ?? ''
    this.merchantCode = process.env.TRIPAY_MERCHANT_CODE ?? ''
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResponse> {
    if (!this.apiKey) {
      return { success: false, error: 'Tripay not configured' }
    }

    const signature = crypto
      .createHmac('sha256', this.privateKey)
      .update(this.merchantCode + req.orderId + req.amount)
      .digest('hex')


    const res = await fetch(`${TRIPAY_API}/transaction/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'QRIS',
        merchant_ref: req.orderId,
        amount: req.amount,
        customer_name: req.customerName ?? 'Customer',
        customer_email: req.customerEmail,
        order_items: [{ name: req.description, price: req.amount, quantity: 1 }],
        callback_url: req.callbackUrl,
        return_url: req.redirectUrl,
        signature,
      }),
    })

    const data = (await res.json()) as {
      success: boolean
      data?: { checkout_url: string; reference: string; qr_code?: string }
      message?: string
    }

    if (!data.success || !data.data) {
      return { success: false, error: data.message ?? 'Tripay payment failed' }
    }

    return {
      success: true,
      paymentUrl: data.data.checkout_url,
      paymentId: data.data.reference,
      qrCode: data.data.qr_code,
    }
  }

  verifyWebhook(headers: Record<string, string>, body: string): WebhookPayload | null {
    const signature = headers['x-signature'] ?? ''
    const expected = crypto
      .createHmac('sha256', this.privateKey)
      .update(body)
      .digest('hex')

    if (signature !== expected) return null

    const data = JSON.parse(body) as {
      merchant_ref: string
      status: string
      amount: number
      created_at: number
    }

    return {
      orderId: data.merchant_ref,
      status: data.status === 'PAID' ? 'success' : data.status === 'EXPIRED' ? 'expired' : 'pending',
      amount: data.amount,
      currency: 'IDR',
      timestamp: data.created_at,
      raw: data as unknown as Record<string, unknown>,
    }
  }

  async checkStatus(paymentId: string): Promise<{ status: string; paid: boolean }> {
    const res = await fetch(`${TRIPAY_API}/transaction/detail?reference=${paymentId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })

    const data = (await res.json()) as { data?: { status: string } }
    const status = data.data?.status ?? 'UNKNOWN'

    return { status, paid: status === 'PAID' }
  }
}
