// ─── Single Source of Truth for Plan Pricing ────────────────
// Used by checkout, account dashboard, pricing page, and payments.
// All surfaces must import from here — never hardcode prices.
// ─────────────────────────────────────────────────────────────

export interface PlanPricing {
  amount: number       // cents / smallest currency unit
  currency: string
  label: string        // display label e.g. "$49/mo"
  description: string
  features: string[]
  /** Monthly API call limit */
  rateLimit: number
}

export const PLAN_PRICING: Record<string, PlanPricing> = {
  free: {
    amount: 0,
    currency: 'USD',
    label: '$0/mo',
    description: 'Basic market data access',
    features: ['100 API calls/day', 'Basic market data', 'Macro indicators'],
    rateLimit: 100,
  },
  pro: {
    amount: 4900,
    currency: 'USD',
    label: '$49/mo',
    description: 'Full data access + signals',
    features: ['10,000 API calls/day', 'All signals', 'Backtest', 'WebSocket streaming'],
    rateLimit: 1000,
  },
  enterprise: {
    amount: 19900,
    currency: 'USD',
    label: '$199/mo',
    description: 'Unlimited access + WebSocket streaming',
    features: ['100,000 API calls/day', 'All signals', 'WebSocket', 'Priority support', 'Historical data'],
    rateLimit: 10000,
  },
}

export function isPaidPlan(plan: string): boolean {
  return plan === 'pro' || plan === 'enterprise'
}

export function getPlanPricing(plan: string): PlanPricing | undefined {
  return PLAN_PRICING[plan]
}

// Ordinal plan tiers for upgrade/downgrade comparisons (free < pro < enterprise)
const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 }

export function getPlanRank(plan: string): number {
  return PLAN_RANK[plan] ?? 0
}

export const FREE_PLAN = 'free'
export const PRO_PLAN = 'pro'
export const ENTERPRISE_PLAN = 'enterprise'