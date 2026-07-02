// ─────────────────────────────────────────────────────────────
// NOWPayments Crypto Payment Provider
// Accept: BTC, ETH, USDT, USDC, SOL, and 100+ cryptos
// Docs: https://documenter.getpostman.com/view/8182628
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type { PaymentProvider, PaymentRequest, PaymentResponse, WebhookPayload } from './types'

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1'

export class NowPaymentsProvider implements PaymentProvider {
  name = 'nowpayments'
  private apiKey: string
  private ipnSecret: string

  constructor() {
    this.apiKey = process.env.NOWPAYMENTS_API_KEY ?? ''
    this.ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET ?? ''
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResponse> {
    if (!this.apiKey) {
      return { success: false, error: 'NOWPayments not configured' }
    }

    // Create invoice
    const res = await fetch(`${NOWPAYMENTS_API}/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: req.amount,
        price_currency: req.currency.toLowerCase(),
        order_id: req.orderId,
        order_description: req.description,
        ipn_callback_url: req.callbackUrl,
        success_url: req.redirectUrl,
        cancel_url: req.redirectUrl,
      }),
    })

    const data = (await res.json()) as {
      id?: string
      invoice_url?: string
      error?: string
    }

    if (!data.invoice_url) {
      return { success: false, error: data.error ?? 'NOWPayments payment failed' }
    }

    return {
      success: true,
      paymentUrl: data.invoice_url,
      paymentId: data.id,
    }
  }

  verifyWebhook(headers: Record<string, string>, body: string): WebhookPayload | null {
    const signature = headers['x-nowpayments-sig'] ?? ''
    const expected = crypto
      .createHmac('sha512', this.ipnSecret)
      .update(body)
      .digest('hex')

    if (signature !== expected) return null

    const data = JSON.parse(body) as {
      order_id: string
      payment_status: string
      price_amount: number
      price_currency: string
      pay_amount?: number
      pay_currency?: string
    }

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
      orderId: data.order_id,
      status: statusMap[data.payment_status] ?? 'pending',
      amount: data.price_amount,
      currency: data.price_currency.toUpperCase(),
      timestamp: Date.now(),
      raw: data as unknown as Record<string, unknown>,
    }
  }

  async checkStatus(paymentId: string): Promise<{ status: string; paid: boolean }> {
    const res = await fetch(`${NOWPAYMENTS_API}/payment/${paymentId}`, {
      headers: { 'x-api-key': this.apiKey },
    })

    const data = (await res.json()) as { payment_status?: string }
    const paid = ['finished', 'confirmed', 'sending'].includes(data.payment_status ?? '')

    return { status: data.payment_status ?? 'unknown', paid }
  }
}
