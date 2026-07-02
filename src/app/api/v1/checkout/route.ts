// ─────────────────────────────────────────────────────────────
// POST /api/v1/checkout — Stripe checkout session creation
// Creates checkout session for subscription plans
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'

// Stripe price IDs (set in env)
const PRICE_IDS: Record<string, string> = {
  pro: process.env.STRIPE_PRICE_PRO ?? 'price_pro_placeholder',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE ?? 'price_enterprise_placeholder',
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { tier?: string; email?: string }
    const { tier = 'pro', email } = body

    if (!PRICE_IDS[tier]) {
      return apiError('Invalid tier', 400)
    }

    // Check if Stripe is configured
    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey) {
      // Return mock response for development
      return apiJson({
        url: `/pricing?session=mock&tier=${tier}`,
        sessionId: `cs_mock_${Date.now()}`,
        tier,
        message: 'Stripe not configured. Set STRIPE_SECRET_KEY to enable payments.',
      })
    }

    // Stripe must be installed: npm install stripe
    // Dynamic import to avoid build errors when not installed
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey)

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[tier], quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.NEXT_PUBLIC_URL ?? 'http://localhost:4400'}/account?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL ?? 'http://localhost:4400'}/pricing`,
    })

    return apiJson({
      url: session.url,
      sessionId: session.id,
      tier,
    })

  } catch (err) {
    console.error('Checkout error:', err)
    return apiError('Failed to create checkout session', 502)
  }
}
