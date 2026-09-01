import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/keys/route'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'
import { generateApiKey } from '@/lib/api-keys'
import { awardXp } from '@/lib/gamification'

vi.mock('@/lib/jwt', () => ({
  verifyToken: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    userApiKey: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock('@/lib/api-keys', () => ({
  generateApiKey: vi.fn(),
  listUserKeys: vi.fn(),
  revokeApiKey: vi.fn(),
  TIER_CONFIG: {
    free: { rateLimit: 100, features: [] },
    pro: { rateLimit: 5000, features: [] },
    enterprise: { rateLimit: 10000, features: [] },
  },
}))

vi.mock('@/lib/gamification', () => ({
  awardXp: vi.fn(),
}))

function authReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/v1/keys', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/v1/keys', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('awards CONNECT_EXCHANGE XP when a service key is created', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1', email: 'test@example.com', role: 'pro', plan: 'pro',
    })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1', email: 'test@example.com', role: 'pro', plan: 'pro',
    } as never)
    vi.mocked(generateApiKey).mockResolvedValue({
      id: 'key-abc123', key: 'nexus_x', name: 'binance', tier: 'pro',
      createdAt: new Date().toISOString(), lastUsedAt: null, requestCount: 0,
      rateLimit: 5000, isActive: true,
    } as never)
    vi.mocked(awardXp).mockResolvedValue({
      awarded: true, xp: 50, totalXp: 50, level: 1,
      action: 'CONNECT_EXCHANGE', refId: 'key:key-abc123', eventId: 'ev-1',
    })

    const res = await POST(authReq({ name: 'binance' }))
    await vi.waitFor(() => expect(awardXp).toHaveBeenCalled())

    expect(res.status).toBe(200)
    expect(verifyToken).toHaveBeenCalledWith('test-token')
    expect(awardXp).toHaveBeenCalledWith('user-1', 'CONNECT_EXCHANGE', 'key:key-abc123')
  })

  it('does not award XP when unauthenticated', async () => {
    const res = await POST(new NextRequest('http://localhost:3000/api/v1/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'binance' }),
    }))

    expect(res.status).toBe(401)
    expect(awardXp).not.toHaveBeenCalled()
  })
})
