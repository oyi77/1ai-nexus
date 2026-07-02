// ─────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/[gateway] — Payment webhook handler
// Verifies signature and updates order status
// ─────────────────────────────────────────────────────────────

import { verifyWebhook, type PaymentMethod } from '@/lib/payments'

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
    console.log(`[Webhook] ${gateway}: Order ${payload.orderId} = ${payload.status}`)

    // TODO: Update order in database
    // await updateOrderStatus(payload.orderId, payload.status)

    return new Response('OK', { status: 200 })

  } catch (err) {
    console.error(`[Webhook] ${gateway} error:`, err)
    return new Response('Error', { status: 500 })
  }
}
