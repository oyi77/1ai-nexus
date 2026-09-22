// ─────────────────────────────────────────────────────────────
// POST /api/v1/admin/refund — Execute a payment refund (admin only).
// Fulfills the Terms §9 promise: error charges get investigated and
// refunded. Flow: gateway refund first, then local Payment row ->
// 'refunded' + subscription downgrade to free. Gateway-first ordering
// means a gateway failure never leaves local state claiming a refund.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'
import { getPaymentService } from '@/lib/payment-service'

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  let body: { paymentId?: string; reason?: string }
  try {
    body = (await request.json()) as { paymentId?: string; reason?: string }
  } catch {
    return apiError('Invalid JSON', 400)
  }
  if (!body.paymentId) return apiError('paymentId is required', 400)

  try {
    const payment = await prisma.payment.findUnique({
      where: { id: body.paymentId },
      include: { subscription: { select: { userId: true, id: true } } },
    })
    if (!payment) return apiError('Payment not found', 404)
    if (payment.status === 'refunded') return apiError('Already refunded', 409)
    if (payment.status !== 'completed') {
      return apiError('Only completed payments can be refunded', 400)
    }
    if (!payment.externalId) return apiError('No gateway order to refund', 400)

    // 1) Gateway refund first — money moves (or throws, aborting below).
    const service = getPaymentService()
    await service.refundPayment(
      payment.externalId,
      payment.amount,
      body.reason ?? 'Terms §9 error-charge review',
    )

    // 2) Local state: mark refunded, downgrade subscription + user.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'refunded' },
    })
    await prisma.subscription.update({
      where: { id: payment.subscriptionId },
      data: { status: 'canceled', canceledAt: new Date() },
    })
    await prisma.user.update({
      where: { id: payment.subscription.userId },
      data: { plan: 'free' },
    })

    return apiJson({ refunded: true, paymentId: payment.id })
  } catch (err) {
    return apiError((err as Error).message || 'Refund failed', 502)
  }
}
