import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { denyUnlessFeature, getUserEntitlement } from '@/lib/entitlements'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    subscription: { findUnique: vi.fn() },
    userApiKey: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/api-keys', () => ({
  validateApiKey: vi.fn(),
  TIER_CONFIG: {
    free: { features: ['market-data', 'macro', 'news'] },
    pro: { features: ['market-data', 'macro', 'news', 'on-chain', 'signals', 'screener'] },
    enterprise: { features: ['market-data', 'macro', 'news', 'on-chain', 'signals', 'screener', 'historical', 'websocket'] },
  },
}))

function jwtRequest(token = 'jwt-token') {
  return new Request('http://localhost:3000/api/v1/alpha-engine', {
    headers: { authorization: `Bearer ${token}` },
  })
}

function mockAuth(role = 'user') {
  vi.mocked(verifyToken).mockResolvedValue({ userId: 'user-1', email: 'u@example.com', role, plan: 'pro' } as never)
}

function mockUser(plan: string, planExpiresAt: Date | null, role = 'user') {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ role, plan, planExpiresAt } as never)
}

const PAST = new Date(Date.now() - 86_400_000)
const FUTURE = new Date(Date.now() + 86_400_000)

describe('denyUnlessFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.NEXUS_API_KEYS
  })
  afterEach(() => delete process.env.NEXUS_API_KEYS)

  it('denies unauthenticated requests with 401', async () => {
    const res = await denyUnlessFeature(new Request('http://localhost/api/v1/alpha-engine'), 'signals')
    expect(res?.status).toBe(401)
  })

  it('allows free-tier market data access', async () => {
    mockAuth()
    mockUser('free', null)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
    expect(await denyUnlessFeature(jwtRequest(), 'market-data')).toBeNull()
  })

  it('denies free users the paid signals feature with 403', async () => {
    mockAuth()
    mockUser('free', null)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
    const res = await denyUnlessFeature(jwtRequest(), 'signals')
    expect(res?.status).toBe(403)
  })

  it('denies an expired paid subscription even when the user cache still says pro', async () => {
    mockAuth()
    mockUser('pro', PAST)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ plan: 'pro', status: 'expired', endDate: PAST } as never)
    const res = await denyUnlessFeature(jwtRequest(), 'signals')
    expect(res?.status).toBe(403)
  })

  it('denies an active subscription whose endDate has passed', async () => {
    mockAuth()
    mockUser('pro', FUTURE)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ plan: 'pro', status: 'active', endDate: PAST } as never)
    const res = await denyUnlessFeature(jwtRequest(), 'signals')
    expect(res?.status).toBe(403)
  })

  it('allows a live paid subscription even when the user cache says free', async () => {
    mockAuth()
    mockUser('free', null)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ plan: 'pro', status: 'active', endDate: FUTURE } as never)
    expect(await denyUnlessFeature(jwtRequest(), 'signals')).toBeNull()
  })

  it('allows an unexpired cached paid plan with no subscription row', async () => {
    mockAuth()
    mockUser('pro', FUTURE)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
    expect(await denyUnlessFeature(jwtRequest(), 'signals')).toBeNull()
  })

  it('preserves legacy paid users with no expiry and no subscription row', async () => {
    mockAuth()
    mockUser('pro', null)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
    expect(await denyUnlessFeature(jwtRequest(), 'signals')).toBeNull()
  })

  it('denies a stale cached paid plan after its expiry with no subscription row', async () => {
    mockAuth()
    mockUser('pro', PAST)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
    const res = await denyUnlessFeature(jwtRequest(), 'signals')
    expect(res?.status).toBe(403)
  })

  it('admits admins regardless of plan', async () => {
    mockAuth('admin')
    mockUser('free', null, 'admin')
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
    expect(await denyUnlessFeature(jwtRequest(), 'signals')).toBeNull()
  })

  it('admits internal service keys without a user lookup', async () => {
    process.env.NEXUS_API_KEYS = 'internal-key'
    const req = new Request('http://localhost/api/v1/alpha-engine', { headers: { authorization: 'Bearer internal-key' } })
    expect(await denyUnlessFeature(req, 'signals')).toBeNull()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the entitlement lookup throws', async () => {
    vi.mocked(verifyToken).mockRejectedValue(new Error('db down'))
    const res = await denyUnlessFeature(jwtRequest(), 'signals')
    expect(res?.status).toBe(503)
  })

  it('authenticates customer nexus_ API keys against durable UserApiKey tier', async () => {
    const { validateApiKey } = await import('@/lib/api-keys')
    vi.mocked(validateApiKey).mockResolvedValue({
      id: 'key-1', key: 'nexus_test', name: 'svc', tier: 'pro',
      createdAt: new Date().toISOString(), lastUsedAt: null, requestCount: 0,
      rateLimit: 1000, isActive: true, windowStart: Date.now(),
    })
    vi.mocked(prisma.userApiKey.findUnique).mockResolvedValue({
      userId: 'user-1', tier: 'pro', isActive: true,
    } as never)
    mockUser('pro', FUTURE)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)

    const req = new Request('http://localhost/api/v1/alpha-engine', {
      headers: { authorization: 'Bearer nexus_test' },
    })
    expect(await denyUnlessFeature(req, 'signals')).toBeNull()
  })

  it('denies revoked customer nexus_ API keys', async () => {
    const { validateApiKey } = await import('@/lib/api-keys')
    vi.mocked(validateApiKey).mockResolvedValue({
      id: 'key-1', key: 'nexus_test', name: 'svc', tier: 'pro',
      createdAt: new Date().toISOString(), lastUsedAt: null, requestCount: 0,
      rateLimit: 1000, isActive: false, windowStart: Date.now(),
    })
    vi.mocked(prisma.userApiKey.findUnique).mockResolvedValue({
      userId: 'user-1', tier: 'pro', isActive: false,
    } as never)

    const req = new Request('http://localhost/api/v1/alpha-engine', {
      headers: { authorization: 'Bearer nexus_test' },
    })
    const res = await denyUnlessFeature(req, 'signals')
    expect(res?.status).toBe(401)
  })

  it('denies customer nexus_ API keys whose key tier lacks the feature even if user is pro', async () => {
    const { validateApiKey } = await import('@/lib/api-keys')
    vi.mocked(validateApiKey).mockResolvedValue({
      id: 'key-1', key: 'nexus_test', name: 'svc', tier: 'free',
      createdAt: new Date().toISOString(), lastUsedAt: null, requestCount: 0,
      rateLimit: 100, isActive: true, windowStart: Date.now(),
    })
    vi.mocked(prisma.userApiKey.findUnique).mockResolvedValue({
      userId: 'user-1', tier: 'free', isActive: true,
    } as never)
    mockUser('pro', FUTURE)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)

    const req = new Request('http://localhost/api/v1/alpha-engine', {
      headers: { authorization: 'Bearer nexus_test' },
    })
    const res = await denyUnlessFeature(req, 'signals')
    expect(res?.status).toBe(403)
  })

})

describe('getUserEntitlement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null for a missing user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
    expect(await getUserEntitlement('missing')).toBeNull()
  })

  it('resolves pro from a live subscription despite a free cache', async () => {
    mockUser('free', null)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ plan: 'pro', status: 'active', endDate: FUTURE } as never)
    expect(await getUserEntitlement('user-1')).toEqual({ plan: 'pro', role: 'user' })
  })
})
