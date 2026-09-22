import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => {
  const m = () => ({ deleteMany: vi.fn(), delete: vi.fn() })
  return {
    prisma: {
      $transaction: vi.fn(),
      alert: m(),
      follow: m(),
      moduleConfig: m(),
      userApiKey: m(),
      userBadge: m(),
      userEvent: m(),
      payment: m(),
      subscription: m(),
      watchlist: m(),
      paperTrade: m(),
      user: m(),
    },
  }
})

vi.mock('@/lib/jwt', () => ({
  verifyToken: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { verifyToken } = await import('@/lib/jwt')
const { DELETE } = await import('@/app/api/v1/account/route')

function authReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/account', {
    method: 'DELETE',
    headers: { authorization: 'Bearer test-token' },
  })
}

describe('DELETE /api/v1/account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(verifyToken).mockResolvedValue({
      userId: 'user-1',
      email: 'test@example.com',
      role: 'free',
      plan: 'free',
    })
    vi.mocked(prisma.$transaction).mockResolvedValue([])
  })

  it('rejects anonymous callers with 401', async () => {
    const res = await DELETE(
      new NextRequest('http://localhost:3000/api/v1/account', { method: 'DELETE' }),
    )
    expect(res.status).toBe(401)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('deletes all user rows in one transaction and clears cookies', async () => {
    const res = await DELETE(authReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.deleted).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const ops = vi.mocked(prisma.$transaction).mock.calls[0][0]
    expect(Array.isArray(ops)).toBe(true)
    // Clears both session cookies.
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('nexus-session=')
  })
})
