// ─────────────────────────────────────────────────────────────
// Midtrans Payment Gateway Provider
// Indonesian all-in-one: Credit Card, VA, QRIS, Gopay, OVO, Dana
// Docs: https://snap-docs.midtrans.com
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type { PaymentProvider, PaymentRequest, PaymentResponse, WebhookPayload } from './types'


export class MidtransProvider implements PaymentProvider {
  name = 'midtrans'
  private serverKey: string
  private clientKey: string
  private isProduction: boolean

  constructor() {
    this.serverKey = process.env.MIDTRANS_SERVER_KEY ?? ''
    this.clientKey = process.env.MIDTRANS_CLIENT_KEY ?? ''
    this.isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true'
  }

  private get apiBase() {
    return this.isProduction ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2'
  }

  private get snapBase() {
    return this.isProduction ? 'https://app.midtrans.com/snap/v1' : 'https://app.sandbox.midtrans.com/snap/v1'
  }

  private get authHeader() {
    return `Basic ${Buffer.from(this.serverKey + ':').toString('base64')}`
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResponse> {
    if (!this.serverKey) {
      return { success: false, error: 'Midtrans not configured' }
    }

    const res = await fetch(`${this.snapBase}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: req.orderId,
          gross_amount: req.amount,
        },
        credit_card: { secure: true },
        customer_details: {
          email: req.customerEmail,
          first_name: req.customerName ?? 'Customer',
        },
        callbacks: {
          finish: req.redirectUrl,
        },
      }),
    })

    const data = (await res.json()) as {
      token?: string
      redirect_url?: string
      error_messages?: string[]
    }

    if (!data.redirect_url) {
      return { success: false, error: data.error_messages?.[0] ?? 'Midtrans payment failed' }
    }

    return {
      success: true,
      paymentUrl: data.redirect_url,
      paymentId: data.token,
    }
  }

  verifyWebhook(headers: Record<string, string>, body: string): WebhookPayload | null {
    const data = JSON.parse(body) as {
      order_id: string
      status_code: string
      gross_amount: string
      signature_key: string
      transaction_status: string
      settlement_time?: string
    }

    // Verify signature
    const expectedSig = crypto
      .createHash('sha512')
      .update(data.order_id + data.status_code + data.gross_amount + this.serverKey)
      .digest('hex')

    if (data.signature_key !== expectedSig) return null

    const statusMap: Record<string, WebhookPayload['status']> = {
      capture: 'success',
      settlement: 'success',
      pending: 'pending',
      deny: 'failed',
      cancel: 'failed',
      expire: 'expired',
    }

    return {
      orderId: data.order_id,
      status: statusMap[data.transaction_status] ?? 'pending',
      amount: parseInt(data.gross_amount),
      currency: 'IDR',
      timestamp: data.settlement_time ? new Date(data.settlement_time).getTime() : Date.now(),
      raw: data as unknown as Record<string, unknown>,
    }
  }

  async checkStatus(orderId: string): Promise<{ status: string; paid: boolean }> {
    const res = await fetch(`${this.apiBase}/${orderId}/status`, {
      headers: { Authorization: this.authHeader },
    })

    const data = (await res.json()) as { transaction_status: string }
    const paid = ['capture', 'settlement'].includes(data.transaction_status)

    return { status: data.transaction_status, paid }
  }
}
