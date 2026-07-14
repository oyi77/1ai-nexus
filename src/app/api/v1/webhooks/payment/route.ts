export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/payment — Handle payment gateway callbacks
// Processes payment status updates from 1ai-payment service
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { prisma } from '@/lib/prisma'

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
    const payload = JSON.parse(rawBody) as WebhookPayload

    // Extract metadata
    const metadata = payload.metadata || {}
    const userId = metadata.userId as string | undefined
    const plan = metadata.plan as string | undefined

    // Only process successful payments
    if (payload.status === 'paid' && userId && plan) {
      // Update or create subscription
      const subscription = await prisma.subscription.upsert({
        where: {
          userId,
        },
        update: {
          plan,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          cancelAtPeriodEnd: false,
        },
        create: {
          userId,
          plan,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          cancelAtPeriodEnd: false,
        },
      })

      // Update user role
      await prisma.user.update({
        where: { id: userId },
        data: { role: plan },
      })

      console.log('Subscription activated:', {
        userId,
        plan,
        subscriptionId: subscription.id,
      })
    } else if (payload.status === 'failed' || payload.status === 'expired') {
      // Log failed/expired payments for monitoring
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
