import { NextRequest } from "next/server";
import { verifyToken } from "./jwt";
import type { UserRole } from "@prisma/client";

export interface JwtSession {
  userId: string;
  email: string;
  role: UserRole;
  plan: UserRole; // Reusing role field as plan for now
}

export interface SubscriptionRateLimit {
  allowed: boolean;
  remaining: number;
  limit: number;
  plan: UserRole;
}

// Subscription-based rate limits (requests per hour)
const PLAN_RATE_LIMITS: Record<UserRole, number> = {
  free: 100,
  pro: 1000,
  enterprise: 10000,
  admin: Infinity, // unlimited
};

// In-memory rate limit tracking per user
interface UserRateLimitEntry {
  count: number;
  resetAt: number;
}

const userRateLimitMap = new Map<string, UserRateLimitEntry>();

/**
 * Extract and verify JWT session from request cookies
 */
export function extractJwtSession(request: NextRequest): JwtSession | null {
  try {
    const sessionCookie = request.cookies.get("nexus-session");
    if (!sessionCookie?.value) {
      return null;
    }

    const payload = verifyToken(sessionCookie.value);
    if (!payload || typeof payload !== "object") {
      return null;
    }

    // Type guard: ensure payload has expected shape
    if (
      !("userId" in payload) ||
      !("email" in payload) ||
      !("role" in payload) ||
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      email: payload.email,
      role: payload.role as UserRole,
      plan: payload.role as UserRole, // Using role as plan
    };
  } catch {
    return null;
  }
}
/**
 * Check subscription-based rate limit for authenticated user
 */
export function checkSubscriptionRateLimit(
  userId: string,
  plan: UserRole
): SubscriptionRateLimit {
  const limit = PLAN_RATE_LIMITS[plan];
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = Date.now();

  // Admin gets unlimited access
  if (plan === "admin") {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      plan,
    };
  }

  const existing = userRateLimitMap.get(userId);

  // No entry or window expired
  if (!existing || now > existing.resetAt) {
    userRateLimitMap.set(userId, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: limit - 1,
      limit,
      plan,
    };
  }

  // Within window
  const remaining = limit - existing.count;
  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      plan,
    };
  }

  // Increment count
  existing.count += 1;
  return {
    allowed: true,
    remaining: remaining - 1,
    limit,
    plan,
  };
}
