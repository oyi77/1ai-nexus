/**
 * Subscription-aware rate limiting for API routes
 * 
 * Rate limits by user plan:
 * - free: 100 requests/hour
 * - pro: 1,000 requests/hour
 * - enterprise: 10,000 requests/hour
 * - admin: unlimited
 */

import { checkRateLimit } from './cache';
import type { UserRole } from '@prisma/client';

interface SubscriptionLimit {
  readonly limit: number;
  readonly window: number; // milliseconds
}

const SUBSCRIPTION_LIMITS: Record<UserRole, SubscriptionLimit> = {
  free: { limit: 100, window: 3_600_000 }, // 100/hour
  pro: { limit: 1_000, window: 3_600_000 }, // 1k/hour
  enterprise: { limit: 10_000, window: 3_600_000 }, // 10k/hour
  admin: { limit: Number.MAX_SAFE_INTEGER, window: 3_600_000 }, // unlimited
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Check rate limit based on user subscription plan
 * 
 * @param userId - User ID from JWT token
 * @param plan - User subscription plan (free, pro, enterprise, admin)
 * @returns Rate limit result with allowed status, remaining requests, and limit
 */
export async function checkSubscriptionRateLimit(
  userId: string,
  plan: UserRole
): Promise<RateLimitResult> {
  const config = SUBSCRIPTION_LIMITS[plan];
  
  // Admin users bypass rate limiting
  if (plan === 'admin') {
    return {
      allowed: true,
      remaining: config.limit,
      limit: config.limit,
    };
  }

  const key = `user:${userId}:${plan}`;
  const { allowed, remaining } = await checkRateLimit(key, config.limit, config.window);

  return {
    allowed,
    remaining,
    limit: config.limit,
  };
}

/**
 * Get subscription limit for a plan without checking current usage
 */
export function getSubscriptionLimit(plan: UserRole): SubscriptionLimit {
  return SUBSCRIPTION_LIMITS[plan];
}
