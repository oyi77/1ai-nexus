// ─────────────────────────────────────────────────────────────
// Subscription lifecycle — expiry sweeper + renewal reminders.
// Problem: paid subscriptions stayed `active` forever after endDate;
// no downgrade, no reminder, no honest recurring story.
// Solution: hourly sweeper — expire past-due actives (downgrade user
// to free), flag 3-day upcoming renewals. Idempotent, silent on empty.
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

/** Effective plan: the subscription row is source of truth while active
 * and unexpired; User.plan is a display cache the sweeper keeps in sync.
 * Every gate MUST use this, never user.plan directly — legacy rows exist
 * where User.plan='free' but an active paid subscription is live. */
export function effectivePlan(
  userPlan: string,
  sub: { plan: string; status: string; endDate: Date | null } | null,
  now = new Date(),
): string {
  if (sub && sub.status === 'active' && sub.endDate && sub.endDate > now && sub.plan !== 'free') {
    return sub.plan
  }
  return userPlan
}

export interface LifecycleResult {
  expired: number
  reminded: number
  checked: number
}

export async function runSubscriptionLifecycle(now = new Date()): Promise<LifecycleResult> {
  const actives = await prisma.subscription.findMany({
    where: { status: 'active' },
    select: { id: true, userId: true, plan: true, endDate: true },
  })
  let expired = 0
  let reminded = 0
  const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60_000)
  for (const s of actives) {
    if (!s.endDate) continue
    // Backfill UP: User.plan is a display cache — if a live paid
    // subscription exists but the cache says otherwise, repair it.
    if (s.endDate > now && s.plan !== 'free') {
      await prisma.user.updateMany({
        where: { id: s.userId, plan: { not: s.plan } },
        data: { plan: s.plan as 'free' | 'pro' | 'enterprise' },
      })
    }
    if (s.endDate <= now) {
      // Expired: close subscription, downgrade user to free.
      await prisma.subscription.update({
        where: { id: s.id },
        data: { status: 'expired' },
      })
      await prisma.user.update({
        where: { id: s.userId },
        data: { plan: 'free', planExpiresAt: s.endDate },
      })
      expired++
    } else if (s.endDate <= threeDays && s.plan !== 'free') {
      // Renewal due within 3 days — count for reminder surfacing.
      // Delivery rides the existing checkout flow (user re-pays to renew);
      // this keeps the lifecycle honest without inventing an auto-charge rail.
      reminded++
    }
  }
  if (expired > 0) logger.info(`lifecycle: ${expired} expired, ${reminded} renewal-due`, 'refresher')
  return { expired, reminded, checked: actives.length }
}
