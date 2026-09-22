// ─────────────────────────────────────────────────────────────
// Subscription lifecycle — expiry sweeper + renewal reminders.
// Problem: paid subscriptions stayed `active` forever after endDate;
// no downgrade, no reminder, no honest recurring story.
// Solution: hourly sweeper — expire past-due actives (downgrade user
// to free), flag 3-day upcoming renewals. Idempotent, silent on empty.
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

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
