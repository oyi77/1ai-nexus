export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/payment — Handle payment gateway callbacks
// Processes payment status updates from 1ai-payment service
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PLAN_PRICING } from '@/lib/pricing'

interface WebhookPayload {
  order_id: string
  status: string
  gateway: string
  amount: number
  currency: string
  paid_at?: string
  metadata?: Record<string, unknown>
}

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  
  return signature === expectedSignature
}

export async function POST(request: Request) {
  try {
    // Get webhook secret from environment
    const webhookSecret = process.env.ONEAI_PAYMENT_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('ONEAI_PAYMENT_WEBHOOK_SECRET not configured')
      return NextResponse.json(
        { error: 'Webhook handler not configured' },
        { status: 500 }
      )
    }

    // Read raw body for signature verification
    const rawBody = await request.text()
    const signature = request.headers.get('x-webhook-signature')

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 400 }
      )
    }

    // Verify signature
    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error('Invalid webhook signature')
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      )
    }

    // Parse payload
    let payload: WebhookPayload
    try {
      payload = JSON.parse(rawBody) as WebhookPayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Extract metadata
    const metadata = payload.metadata || {}
    const userId = metadata.userId as string | undefined
    const plan = metadata.plan as string | undefined

    // Defense-in-depth: after HMAC verification, cross-validate the charged
    // amount against the plan's single-source price. Reject mismatches outright
    // so a tampered/incorrect amount can never activate a subscription.
    if (payload.status === 'paid' && plan && userId) {
      const planPricing = PLAN_PRICING[plan]
      if (!planPricing || payload.amount !== planPricing.amount) {
        console.error('Webhook amount mismatch', { plan, expected: planPricing?.amount, got: payload.amount })
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
      }
    }

    // Only process successful payments
    if (payload.status === 'paid' && userId && plan) {
      try {
        // Upsert subscription
        const startDate = new Date()
        const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

        const subscription = await prisma.subscription.upsert({
          where: { userId },
          update: {
            plan: plan as 'free' | 'pro' | 'enterprise',
            status: 'active' as 'active' | 'canceled' | 'expired' | 'trial',
            startDate,
            endDate,
            canceledAt: null,
          },
          create: {
            userId,
            plan: plan as 'free' | 'pro' | 'enterprise',
            status: 'active' as 'active' | 'canceled' | 'expired' | 'trial',
            startDate,
            endDate,
          },
        })

        // Update subscription tier fields so the account page reflects the
        // paid plan. We deliberately do NOT touch user.role — role is
        // authorization (admin etc.) and must not be clobbered by a payment.
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan: plan as 'free' | 'pro' | 'enterprise',
            planStartedAt: startDate,
            planExpiresAt: endDate,
          },
        })

        // Create Payment record
        await prisma.payment.create({
          data: {
            subscriptionId: subscription.id,
            amount: payload.amount,
            currency: payload.currency,
            status: 'completed',
            provider: payload.gateway,
            externalId: payload.order_id,
            metadata: payload.metadata as unknown as Prisma.InputJsonValue,
          },
        })

        console.log('Subscription activated:', {
          userId,
          plan,
          subscriptionId: subscription.id,
        })
      } catch (err) {
        console.error('[PAYMENT] DB write failed for PAID webhook — retry needed:', err)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
      }
    } else if (payload.status === 'failed' || payload.status === 'expired') {
      // Create failed Payment record if we have enough info
      if (userId) {
        const sub = await prisma.subscription.findUnique({ where: { userId } })
        if (sub) {
          await prisma.payment.create({
            data: {
              subscriptionId: sub.id,
              amount: payload.amount,
              currency: payload.currency,
              status: 'failed',
              provider: payload.gateway,
              externalId: payload.order_id,
              metadata: payload.metadata as unknown as Prisma.InputJsonValue,
            },
          })
        }
      }

      console.warn('Payment not completed:', {
        orderId: payload.order_id,
        status: payload.status,
        userId,
      })
    }

    // Return 200 OK to acknowledge webhook
    return NextResponse.json({ received: true })

  } catch (err) {
    console.error('Webhook processing error:', err)
    
    // Return 200 to prevent retries for malformed payloads
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 200 }
    )
  }
}
