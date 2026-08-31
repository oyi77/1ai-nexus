// ─────────────────────────────────────────────────────────────
// GET /api/v1/account/me — Authenticated user account overview
// Returns user profile, subscription, API keys, and usage.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'
import { listUserKeys } from '@/lib/api-keys'
import { getPlanPricing } from '@/lib/pricing'

export async function GET(request: NextRequest) {
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

  try {
    const [user, subscription, apiKeys] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          plan: true,
          planStartedAt: true,
          planExpiresAt: true,
          apiUsageCount: true,
          lastApiUsageReset: true,
          createdAt: true,
        },
      }),
      prisma.subscription.findUnique({ where: { userId } }),
      listUserKeys(userId),
    ])

    if (!user) return apiError('User not found', 404)

    const plan = getPlanPricing(user.plan)

    return apiJson({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        plan: user.plan,
        planStartedAt: user.planStartedAt,
        planExpiresAt: user.planExpiresAt,
        apiUsageCount: user.apiUsageCount,
        createdAt: user.createdAt,
      },
      subscription: subscription
        ? {
            status: subscription.status,
            plan: subscription.plan,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
          }
        : null,
      apiKeys,
      plan: plan
        ? {
            label: plan.label,
            description: plan.description,
            features: plan.features,
            rateLimit: plan.rateLimit,
          }
        : null,
      usage: {
        calls: user.apiUsageCount,
        limit: plan?.rateLimit ?? 100,
      },
    })
  } catch (err) {
    console.error('Account fetch error:', err)
    return apiError('Failed to fetch account', 500)
  }
}