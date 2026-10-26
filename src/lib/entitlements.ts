import { apiError } from '@/lib/api/response'
import { TIER_CONFIG, validateApiKey } from '@/lib/api-keys'
import { prisma } from '@/lib/db'
import { verifyToken } from '@/lib/jwt'
import { effectivePlan } from '@/lib/subscription-lifecycle'

type PlanTier = keyof typeof TIER_CONFIG
export type ApiFeature = (typeof TIER_CONFIG)[PlanTier]['features'][number]

const asTier = (value: string): PlanTier => (value === 'pro' || value === 'enterprise' ? value : 'free')
export async function getUserEntitlement(userId: string): Promise<{ plan: PlanTier; role: string } | null> {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, plan: true, planExpiresAt: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      select: { plan: true, status: true, endDate: true },
    }),
  ])
  if (!user) return null
  return { plan: asTier(effectivePlan(user.plan, subscription, new Date(), user.planExpiresAt)), role: user.role }
}


/**
 * Feature gate for premium API endpoints. Plan and key tier are read from
 * durable rows, never from JWT/key claims, so an expired subscription or a
 * revoked/downgraded key denies access immediately. Admins bypass the check.
 * Returns the denial response, or null when the request may proceed.
 */
export async function denyUnlessFeature(request: Request, feature: ApiFeature) {
  try {
    const authorization = request.headers.get('authorization')
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null

    // NEXUS_API_KEYS are internal service credentials, not customer plan keys.
    if (bearer && process.env.NEXUS_API_KEYS?.split(',').map(k => k.trim()).includes(bearer)) return null

    let userId: string | null = null
    let keyTier: PlanTier | null = null
    if (bearer?.startsWith('nexus_')) {
      const key = await validateApiKey(bearer)
      const row = key && await prisma.userApiKey.findUnique({
        where: { id: key.id },
        select: { userId: true, tier: true, isActive: true },
      })
      if (!row?.isActive) return apiError('Invalid or revoked API key', 401)
      userId = row.userId
      keyTier = asTier(row.tier)
    } else {
      const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)nexus-session=([^;]+)/)?.[1]
      const token = bearer ?? (cookie ? decodeURIComponent(cookie) : null)
      const payload = token ? await verifyToken(token) : null
      if (!payload?.userId) return apiError('Authentication required', 401)
      userId = payload.userId
    }
    const entitlement = await getUserEntitlement(userId)
    if (!entitlement) return apiError('Authentication required', 401)
    if (entitlement.role === 'admin') return null

    const allowed = (TIER_CONFIG[entitlement.plan].features as readonly string[]).includes(feature)
      && (!keyTier || (TIER_CONFIG[keyTier].features as readonly string[]).includes(feature))
    return allowed ? null : apiError('This feature requires an active plan that includes ' + feature, 403)
  } catch (error) {
    console.error('Feature entitlement lookup failed:', error)
    return apiError('Failed to verify feature access', 503)
  }
}
