// ─────────────────────────────────────────────────────────────
// Duitku Payment Gateway Provider
// Indonesian payment: VA (BCA, BNI, BRI, Mandiri), Alfamart, Indomaret
// Docs: https://docs.duitku.com
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type { PaymentProvider, PaymentRequest, PaymentResponse, WebhookPayload } from './types'

const DUITKU_API = 'https://passport.duitku.com/webapi/api'

export class DuitkuProvider implements PaymentProvider {
  name = 'duitku'
  private merchantCode: string
  private apiKey: string

  constructor() {
    this.merchantCode = process.env.DUITKU_MERCHANT_CODE ?? ''
    this.apiKey = process.env.DUITKU_API_KEY ?? ''
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResponse> {
    if (!this.apiKey) {
      return { success: false, error: 'Duitku not configured' }
    }

    const signature = crypto
      .createHash('sha256')
      .update(this.merchantCode + req.orderId + req.amount + this.apiKey)
      .digest('hex')

    const res = await fetch(`${DUITKU_API}/merchant/createInvoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        paymentAmount: req.amount,
        merchantOrderId: req.orderId,
        productDetails: req.description,
        customerVaName: req.customerName ?? 'Customer',
        email: req.customerEmail,
        callbackUrl: req.callbackUrl,
        returnUrl: req.redirectUrl,
        signature,
      }),
    })

    const data = (await res.json()) as {
      statusCode?: string
      paymentUrl?: string
      reference?: string
      errorMessage?: string
    }

    if (data.statusCode !== '00' || !data.paymentUrl) {
      return { success: false, error: data.errorMessage ?? 'Duitku payment failed' }
    }

    return {
      success: true,
      paymentUrl: data.paymentUrl,
      paymentId: data.reference,
    }
  }

  verifyWebhook(headers: Record<string, string>, body: string): WebhookPayload | null {
    const data = JSON.parse(body) as {
      merchantCode: string
      merchantOrderId: string
      amount: string
      signature: string
    }

    const expected = crypto
      .createHash('sha256')
      .update(data.merchantCode + data.merchantOrderId + data.amount + this.apiKey)
      .digest('hex')

    if (data.signature !== expected) return null

    return {
      orderId: data.merchantOrderId,
      status: 'success',
      amount: parseInt(data.amount),
      currency: 'IDR',
      timestamp: Date.now(),
      raw: data as unknown as Record<string, unknown>,
    }
  }

  async checkStatus(orderId: string): Promise<{ status: string; paid: boolean }> {
    const signature = crypto
      .createHash('sha256')
      .update(this.merchantCode + orderId + this.apiKey)
      .digest('hex')

    const res = await fetch(`${DUITKU_API}/merchant/transactionStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        merchantOrderId: orderId,
        signature,
      }),
    })

    const data = (await res.json()) as { statusCode?: string }
    return { status: data.statusCode ?? 'UNKNOWN', paid: data.statusCode === '00' }
  }
}
