import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    subscription: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

const { prisma } = await import('@/lib/db')
const { runSubscriptionLifecycle } = await import('@/lib/subscription-lifecycle')

describe('runSubscriptionLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expires past-due actives and downgrades the user', async () => {
    const past = new Date('2026-08-01T00:00:00Z')
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { id: 's1', userId: 'u1', plan: 'pro', endDate: past },
    ] as never)
    const res = await runSubscriptionLifecycle(new Date('2026-09-22T00:00:00Z'))
    expect(res).toEqual({ expired: 1, reminded: 0, checked: 1 })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'expired' },
    })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { plan: 'free', planExpiresAt: past },
    })
  })

  it('flags renewals due within 3 days without touching them', async () => {
    const soon = new Date('2026-09-23T12:00:00Z')
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { id: 's2', userId: 'u2', plan: 'pro', endDate: soon },
    ] as never)
    const res = await runSubscriptionLifecycle(new Date('2026-09-22T00:00:00Z'))
    expect(res).toEqual({ expired: 0, reminded: 1, checked: 1 })
    expect(prisma.subscription.update).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('ignores far-future actives and dateless rows', async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { id: 's3', userId: 'u3', plan: 'pro', endDate: new Date('2026-12-01T00:00:00Z') },
      { id: 's4', userId: 'u4', plan: 'pro', endDate: null },
    ] as never)
    const res = await runSubscriptionLifecycle(new Date('2026-09-22T00:00:00Z'))
    expect(res).toEqual({ expired: 0, reminded: 0, checked: 2 })
    expect(prisma.subscription.update).not.toHaveBeenCalled()
  })
})

describe('effectivePlan', () => {
  it('prefers a live paid subscription over a stale free cache', async () => {
    const { effectivePlan } = await import('@/lib/subscription-lifecycle')
    expect(
      effectivePlan('free', { plan: 'pro', status: 'active', endDate: new Date('2026-10-22T00:00:00Z') }, new Date('2026-09-22T00:00:00Z')),
    ).toBe('pro')
  })

  it('falls back to user plan when subscription expired', async () => {
    const { effectivePlan } = await import('@/lib/subscription-lifecycle')
    expect(
      effectivePlan('free', { plan: 'pro', status: 'expired', endDate: new Date('2026-08-01T00:00:00Z') }, new Date('2026-09-22T00:00:00Z')),
    ).toBe('free')
  })

  it('ignores free subscriptions', async () => {
    const { effectivePlan } = await import('@/lib/subscription-lifecycle')
    expect(
      effectivePlan('free', { plan: 'free', status: 'active', endDate: new Date('2026-10-22T00:00:00Z') }, new Date('2026-09-22T00:00:00Z')),
    ).toBe('free')
  })
})
