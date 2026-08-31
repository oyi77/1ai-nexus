export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// GET /api/v1/payments/:orderId — Check payment status
// Returns current status of payment order from 1ai-payment service.
// Auth required + ownership-scoped: a user may only view orders that
// were created for them (order.metadata.userId === session userId).
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { getPaymentService } from '@/lib/payment-service'
import { verifyToken } from '@/lib/jwt'
import type { NextRequest } from 'next/server'

interface RouteParams {
  params: Promise<{
    orderId: string
  }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // Require an authenticated user.
    let token: string | undefined
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    } else {
      token = request.cookies.get('nexus-session')?.value
    }
    if (!token) return apiError('Authentication required', 401)
    const payload = await verifyToken(token)
    if (!payload?.userId) return apiError('Invalid or expired token', 401)
    const userId = payload.userId

    const { orderId } = await params

    // Validate orderId format
    if (!orderId || typeof orderId !== 'string') {
      return apiError('Invalid orderId parameter', 400)
    }

    // Get payment status from service
    const paymentService = getPaymentService()
    const order = await paymentService.getPaymentStatus(orderId)

    // Ownership check: order.metadata.userId must match the session user.
    // Different orderId responses are 404 (no existence disclosure).
    const orderUserId = (order.metadata as { userId?: string } | undefined)?.userId
    if (!orderUserId || orderUserId !== userId) {
      return apiError('Payment order not found', 404)
    }

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
