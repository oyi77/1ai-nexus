export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// GET /api/v1/payments/:orderId — Check payment status
// Returns current status of payment order from 1ai-payment service
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { getPaymentService } from '@/lib/payment-service'

interface RouteParams {
  params: Promise<{
    orderId: string
  }>
}

export async function GET(
  _request: Request,
  { params }: RouteParams
) {
  try {
    const { orderId } = await params

    // Validate orderId format
    if (!orderId || typeof orderId !== 'string') {
      return apiError('Invalid orderId parameter', 400)
    }

    // Get payment status from service
    const paymentService = getPaymentService()
    const order = await paymentService.getPaymentStatus(orderId)

    // Return payment details
    return apiJson({
      orderId: order.orderId,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      gateway: order.gateway,
      paymentUrl: order.paymentUrl,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      metadata: order.metadata,
    })

  } catch (err) {
    console.error('Payment status error:', err)
    
    // Handle specific errors
    if (err instanceof Error) {
      if (err.message.includes('Payment service not configured')) {
        return apiError('Payment service not available', 503)
      }
      if (err.message.includes('not found')) {
        return apiError('Payment order not found', 404)
      }
      if (err.message.includes('Failed to fetch payment')) {
        return apiError('Failed to fetch payment status', 502)
      }
    }

    return apiError('Failed to get payment status', 500)
  }
}
