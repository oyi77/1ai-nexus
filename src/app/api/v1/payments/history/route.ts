// ─────────────────────────────────────────────────────────────
// GET /api/v1/payments/history — Get user's payment history
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { apiPaginated, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'
import type { PaymentStatus, Prisma } from '@prisma/client'
export async function GET(request: NextRequest) {
  try {
    // Auth: JWT required — from Authorization header or nexus-session cookie
    let token: string | undefined
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    } else {
      token = request.cookies.get('nexus-session')?.value
    }
    if (!token) {
      return apiError('Authentication required', 401)
    }
    const payload = await verifyToken(token)
    if (!payload) {
      return apiError('Invalid or expired token', 401)
    }

    // Parse pagination & optional status filter
    const url = new URL(request.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '10') || 10))
    const status = url.searchParams.get('status') || undefined

    // Find user's subscription
    const sub = await prisma.subscription.findUnique({
      where: { userId: payload.userId },
    })
    if (!sub) {
      return apiPaginated([], 0, page, pageSize)
    }

    // Build filter for user's payments
    const where: Prisma.PaymentWhereInput = { subscriptionId: sub.id }
    if (status) {
      where.status = status as PaymentStatus
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.payment.count({ where }),
    ])

    return apiPaginated(payments, total, page, pageSize)
  } catch (err) {
    console.error('Payment history error:', err)
    return apiError('Failed to fetch payment history', 500)
  }
}
