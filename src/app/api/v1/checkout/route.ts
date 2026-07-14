export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/checkout — Create payment via 1ai-payment service
// Creates payment order for subscription plans
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getPaymentService } from '@/lib/payment-service'
import { verifyToken, extractTokenFromCookies } from '@/lib/jwt'
import type { UserRole } from '@prisma/client'

// Plan pricing configuration
const PLAN_PRICING: Record<string, { amount: number; currency: string }> = {
  free: { amount: 0, currency: 'USD' },
  pro: { amount: 4900, currency: 'USD' }, // $49.00
  enterprise: { amount: 19900, currency: 'USD' }, // $199.00
}

interface CheckoutRequest {
  plan: string
  email?: string
  gateway?: string
  returnUrl?: string
  cancelUrl?: string
}

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = await request.json() as CheckoutRequest & { customerEmail?: string }
    const { plan, email, customerEmail, gateway, returnUrl, cancelUrl } = body

    // Validate plan
    if (!plan) {
      return NextResponse.json(
        { success: false, error: 'Plan is required' },
        { status: 400 }
      )
    }
    if (!PLAN_PRICING[plan]) {
      return NextResponse.json(
        { success: false, error: 'Invalid plan. Must be pro or enterprise' },
        { status: 400 }
      )
    }
    // Free plan doesn't need payment
    if (plan === 'free') {
      return NextResponse.json(
        { success: false, error: 'Free plan does not require payment' },
        { status: 400 }
      )
    }

    // Extract user from JWT (optional - allow unauthenticated checkout)
    let userId: string | undefined
    let userEmail: string | undefined
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : extractTokenFromCookies(request.headers.get('cookie'))
    if (token) {
      try {
        const payload = await verifyToken(token)
        if (payload) {
          userId = payload.userId
          userEmail = payload.email || undefined
        }
      } catch {
        // Continue without userId - allow guest checkout
      }
    }
    // Guest checkout requires email
    if (!userId && !email && !customerEmail) {
      return NextResponse.json(
        { success: false, error: 'Email required for guest checkout' },
        { status: 400 }
      )
    }

    // Get customer email (from request body or JWT)
    const finalEmail = email || customerEmail || userEmail

    // Get pricing for selected plan
    const pricing = PLAN_PRICING[plan]
    if (!pricing) {
      return NextResponse.json(
        { success: false, error: 'Invalid plan' },
        { status: 400 }
      )
    }

    // Determine gateway, defaults to midtrans
    const selectedGateway = gateway || 'midtrans'

    // Determine return/cancel URLs from request headers or env
    const origin = request.headers.get('origin') || request.headers.get('referer') || process.env.NEXT_PUBLIC_APP_URL || ''
    const returnDestination = returnUrl || `${origin}/account/payments`
    const cancelDestination = cancelUrl || `${origin}/checkout`

    // Create payment order
    const paymentService = getPaymentService()
    const order = await paymentService.createSubscriptionPayment({
      userId: userId || 'guest',
      plan: plan as UserRole,
      amount: pricing.amount,
      currency: pricing.currency,
      gateway: selectedGateway,
      customerEmail: finalEmail || '',
      returnUrl: returnDestination,
      cancelUrl: cancelDestination,
    })
    return NextResponse.json({
      success: true,
      orderId: order.orderId,
      paymentUrl: order.paymentUrl,
      amount: order.amount,
      currency: order.currency,
    })

  } catch (err) {
    console.error('Checkout error:', err)
    const message = err instanceof Error ? err.message : 'Failed to create checkout session'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
