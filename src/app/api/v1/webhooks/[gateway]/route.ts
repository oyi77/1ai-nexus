// ─────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/[gateway] — Payment webhook handler
// Verifies signature and updates order status
// ─────────────────────────────────────────────────────────────

import { verifyWebhook, type PaymentMethod } from '@/lib/payments'
import { logger } from '@/lib/logger'

const VALID_METHODS: PaymentMethod[] = ['tripay', 'midtrans', 'duitku', 'nowpayments']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateway: string }> }
) {
  const { gateway } = await params

  if (!VALID_METHODS.includes(gateway as PaymentMethod)) {
    return new Response('Invalid gateway', { status: 400 })
  }

  try {
    const body = await request.text()
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    const payload = verifyWebhook(gateway as PaymentMethod, headers, body)

    if (!payload) {
      return new Response('Invalid signature', { status: 401 })
    }

    // Process payment status
    logger.info(`Order ${payload.orderId} = ${payload.status}`, 'webhook', { gateway })

    // NOTE: Order persistence not yet implemented — no Order model in schema.
    // When implementing: create Order model, add updateOrderStatus(), handle idempotency.

    return new Response('OK', { status: 200 })

  } catch (err) {
    logger.error(`${gateway} webhook error`, 'webhook', { error: (err as Error).message })
    return new Response('Error', { status: 500 })
  }
}
