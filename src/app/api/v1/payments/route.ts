// ─────────────────────────────────────────────────────────────
// POST /api/v1/payments — Create payment with selected gateway
// GET /api/v1/payments — List available payment methods
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { createPayment, getAvailableMethods, type PaymentMethod } from '@/lib/payments'

export async function GET() {
  return apiJson({ methods: getAvailableMethods() })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      method?: PaymentMethod
      tier?: string
      email?: string
      name?: string
    }

    const { method = 'tripay', tier = 'pro', email, name } = body

    if (!email) {
      return apiError('Email is required', 400)
    }

    const prices: Record<string, number> = {
      pro: 29,
      enterprise: 99,
    }

    const amount = prices[tier]
    if (!amount) {
      return apiError('Invalid tier', 400)
    }

    const orderId = `NXS-${tier.toUpperCase()}-${Date.now()}`

    const result = await createPayment(method, {
      orderId,
      amount: method === 'nowpayments' ? amount : amount * 15500, // Convert USD to IDR for Indonesian gateways
      currency: method === 'nowpayments' ? 'USD' : 'IDR',
      description: `NEXUS ${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan`,
      customerEmail: email,
      customerName: name,
      callbackUrl: `${process.env.NEXT_PUBLIC_URL ?? 'http://localhost:4400'}/api/v1/webhooks/${method}`,
      redirectUrl: `${process.env.NEXT_PUBLIC_URL ?? 'http://localhost:4400'}/account?payment=success`,
    })

    if (!result.success) {
      return apiError(result.error ?? 'Payment creation failed', 400)
    }

    return apiJson({
      orderId,
      paymentUrl: result.paymentUrl,
      paymentId: result.paymentId,
      qrCode: result.qrCode,
      method,
      tier,
      amount: method === 'nowpayments' ? `$${amount}` : `Rp${(amount * 15500).toLocaleString()}`,
    })

  } catch (err) {
    console.error('Payment error:', err)
    return apiError('Failed to create payment', 502)
  }
}
