export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/checkout — Create payment via 1ai-payment service
// Creates payment order for subscription plans.
// Requires an authenticated user (subscription activation needs userId).
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getPaymentService } from '@/lib/payment-service'
import { verifyToken, extractTokenFromCookies } from '@/lib/jwt'
import { PLAN_PRICING, isPaidPlan, getPlanRank } from '@/lib/pricing'
import type { SubscriptionPlan } from '@prisma/client'
import { prisma } from '@/lib/db'

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
    if (!(plan in PLAN_PRICING)) {
      return NextResponse.json(
        { success: false, error: 'Invalid plan. Must be pro or enterprise' },
        { status: 400 }
      )
    }
    // Free plan doesn't need payment
    if (!isPaidPlan(plan)) {
      return NextResponse.json(
        { success: false, error: 'Free plan does not require payment' },
        { status: 400 }
      )
    }

    // Require authenticated user (subscription activation needs userId)
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
        // Token invalid — fall through to 401
      }
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Sign in to purchase a subscription.' },
        { status: 401 }
      )
    }

    // Reject downgrades: if the user already has a higher active plan, block it.
    // A plan is "active" while planExpiresAt is in the future (or a paid plan
    // with no expiry set). An expired plan no longer blocks a lower re-subscribe.
    try {
      const existingUser = await prisma.user.findUnique({ where: { id: userId } })
      if (existingUser) {
        const currentPlan = existingUser.plan
        const expiry = existingUser.planExpiresAt
        const isActive = expiry ? expiry.getTime() > Date.now() : currentPlan !== 'free'
        if (isActive && getPlanRank(currentPlan) > getPlanRank(plan)) {
          return NextResponse.json(
            { success: false, error: 'You already have a higher active plan. Downgrades are not allowed.' },
            { status: 400 }
          )
        }
      }
    } catch (err) {
      // Fail-open on DB read errors: a lookup failure must not block a legitimate purchase.
      console.error('Failed to read user plan for downgrade check:', err)
    }

    // Get customer email (from request body or JWT)
    const finalEmail = email || customerEmail || userEmail || ''

    // Get pricing for selected plan (single source of truth)
    const pricing = PLAN_PRICING[plan]

    // Determine gateway, defaults to midtrans
    const selectedGateway = gateway || 'midtrans'

    // Determine return/cancel URLs from request headers or env
    const origin = request.headers.get('origin') || request.headers.get('referer') || process.env.NEXT_PUBLIC_APP_URL || ''
    const returnDestination = returnUrl || `${origin}/account/payments`
    const cancelDestination = cancelUrl || `${origin}/pricing`

    // Create payment order
    const paymentService = getPaymentService()
    const order = await paymentService.createSubscriptionPayment({
      userId,
      plan: plan as SubscriptionPlan,
      amount: pricing.amount,
      currency: pricing.currency,
      gateway: selectedGateway,
      customerEmail: finalEmail,
      returnUrl: returnDestination,
      cancelUrl: cancelDestination,
    })

    // Defense-in-depth: the gateway must charge exactly the plan's single-source
    // price. A mismatched amount is rejected before any order is handed back.
    if (order.amount !== pricing.amount) {
      console.error('Checkout amount mismatch', { plan, expected: pricing.amount, got: order.amount })
      return NextResponse.json(
        { success: false, error: 'Payment amount does not match plan pricing' },
        { status: 400 }
      )
    }

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