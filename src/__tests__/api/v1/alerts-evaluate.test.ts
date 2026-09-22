import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    alert: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/jwt', () => ({
  verifyToken: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { verifyToken } = await import('@/lib/jwt')
const { GET } = await import('@/app/api/v1/alerts/evaluate/route')

function req(init?: Record<string, unknown>): NextRequest {
  const headers: Record<string, string> = {
    authorization: 'Bearer test-token',
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  return new NextRequest('http://localhost:3000/api/v1/alerts/evaluate', {
    ...(init as object),
    headers,
  } as ConstructorParameters<typeof NextRequest>[1])
}

describe('GET /api/v1/alerts/evaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1',
      email: 'test@example.com',
      role: 'free',
      plan: 'free',
    })
    vi.mocked(prisma.alert.findMany).mockResolvedValue([])
  })

  it('rejects anonymous callers with 401', async () => {
    const res = await GET(
      new NextRequest('http://localhost:3000/api/v1/alerts/evaluate'),
    )
    expect(res.status).toBe(401)
    expect(prisma.alert.findMany).not.toHaveBeenCalled()
  })

  it('scopes evaluation to the caller userId (no cross-user leak)', async () => {
    await GET(req())
    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: { isActive: true, userId: 'user-1' },
    })
  })

  it('never evaluates another user alerts', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-2',
      email: 'other@example.com',
      role: 'free',
      plan: 'free',
    })
    await GET(req())
    const where = vi.mocked(prisma.alert.findMany).mock.calls[0][0]?.where as {
      userId?: string
    }
    expect(where?.userId).toBe('user-2')
    expect(where).not.toHaveProperty('userId', 'user-1')
  })
})
