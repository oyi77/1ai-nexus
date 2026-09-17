// Q2 — admin integrations route tests (mocked admin-auth, DB, upstream).
// Guards: identical 403 for anonymous/non-admin, 400 on bad shape,
// nothing saved when validation fails, values never echoed.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    integrationSecret: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/secrets', () => ({
  writeSecret: vi.fn(),
  readSecret: vi.fn(),
}))

vi.mock('@/lib/modules/market/provider/idx-stockbit/session', () => ({
  refreshStockbitSession: vi.fn(),
  redactJwt: (s: string) => s.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'JWT<redacted>'),
}))

const { requireAdmin } = await import('@/lib/admin-auth')
const { prisma } = await import('@/lib/db')
const { writeSecret } = await import('@/lib/secrets')
const { refreshStockbitSession } = await import(
  '@/lib/modules/market/provider/idx-stockbit/session'
)
const { GET, POST, DELETE } = await import('./route')

const mockRequireAdmin = vi.mocked(requireAdmin)
const pdb = prisma as unknown as {
  integrationSecret: { findMany: Mock; deleteMany: Mock }
}
const mockFindMany = vi.mocked(pdb.integrationSecret.findMany)
const mockDeleteMany = vi.mocked(pdb.integrationSecret.deleteMany)
const mockWriteSecret = vi.mocked(writeSecret)
const mockRefresh = vi.mocked(refreshStockbitSession)

function anonGet() {
  return new NextRequest('http://localhost/api/v1/admin/integrations')
}

function post(body: unknown) {
  return new NextRequest('http://localhost/api/v1/admin/integrations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/admin/integrations (Q2)', () => {
  it('anonymous → 403', async () => {
    mockRequireAdmin.mockResolvedValue(null)
    const res = await GET(anonGet())
    expect(res.status).toBe(403)
    const json = (await res.json()) as { data: unknown; error: string | null }
    expect(json.data).toBeNull()
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('non-admin → identical 403 body (no existence oracle)', async () => {
    mockRequireAdmin.mockResolvedValue(null)
    const res = await GET(anonGet())
    const json = (await res.json()) as { data: unknown; error: string | null }
    expect(res.status).toBe(403)
    expect(json).toEqual({ data: null, error: 'Forbidden' })
  })

  it('admin → list without values', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mockFindMany.mockResolvedValue([
      { key: 'stockbit_refresh_token', updatedAt: new Date('2026-09-17T00:00:00Z') },
    ])
    const res = await GET(anonGet())
    expect(res.status).toBe(200)
    const raw = await res.text()
    expect(raw).not.toMatch(/encValue|refreshToken|eyJ/)
    const json = JSON.parse(raw) as {
      data: { items: { key: string; label: string; staged: boolean; updatedAt: string | null; healthy: boolean }[] }
      error: string | null
    }
    expect(json.data.items).toHaveLength(1)
    expect(json.data.items[0]).toMatchObject({ key: 'stockbit_refresh_token', staged: true, healthy: true })
  })

  it('admin, nothing staged → staged false', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mockFindMany.mockResolvedValue([])
    const res = await GET(anonGet())
    const json = (await res.json()) as { data: { items: { staged: boolean }[] }; error: string | null }
    expect(json.data.items[0].staged).toBe(false)
  })
})

describe('POST /api/v1/admin/integrations (Q2)', () => {
  it('anonymous → 403, upstream never touched', async () => {
    mockRequireAdmin.mockResolvedValue(null)
    const res = await POST(post({ key: 'stockbit_refresh_token', value: 'a.b.c' }))
    expect(res.status).toBe(403)
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockWriteSecret).not.toHaveBeenCalled()
  })

  it('unknown key → 400', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    const res = await POST(post({ key: 'nope', value: 'a.b.c' }))
    expect(res.status).toBe(400)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('non-JWT value → 400, nothing saved', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    const res = await POST(post({ key: 'stockbit_refresh_token', value: 'not-a-jwt' }))
    expect(res.status).toBe(400)
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockWriteSecret).not.toHaveBeenCalled()
  })

  it('JWT-shaped but rejected upstream → 502, nothing saved', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mockRefresh.mockRejectedValue(new Error('401 unauthorized'))
    const res = await POST(post({ key: 'stockbit_refresh_token', value: 'aaa.bbb.ccc' }))
    expect(res.status).toBe(502)
    const json = (await res.json()) as { data: unknown; error: string | null }
    expect(json.data).toBeNull()
    expect(mockWriteSecret).not.toHaveBeenCalled()
  })

  it('live token → saves the ROTATED pair, echoes no value', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mockRefresh.mockResolvedValue({
      accessToken: 'new-at',
      accessTokenExp: Date.now() + 3600_000,
      refreshToken: 'rotated-rt',
    })
    const res = await POST(post({ key: 'stockbit_refresh_token', value: 'aaa.bbb.ccc' }))
    expect(res.status).toBe(200)
    expect(mockWriteSecret).toHaveBeenCalledWith('stockbit_refresh_token', 'rotated-rt')
    const raw = await res.text()
    expect(raw).not.toMatch(/rotated-rt|aaa\.bbb\.ccc/)
    expect(JSON.parse(raw).data).toMatchObject({ ok: true })
  })
})

describe('DELETE /api/v1/admin/integrations (Q2)', () => {
  it('anonymous → 403', async () => {
    mockRequireAdmin.mockResolvedValue(null)
    const res = await DELETE(
      new NextRequest('http://localhost/api/v1/admin/integrations?key=stockbit_refresh_token', { method: 'DELETE' }),
    )
    expect(res.status).toBe(403)
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  it('admin unknown key → 400', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    const res = await DELETE(
      new NextRequest('http://localhost/api/v1/admin/integrations?key=nope', { method: 'DELETE' }),
    )
    expect(res.status).toBe(400)
  })

  it('admin revokes staged key', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mockDeleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(
      new NextRequest('http://localhost/api/v1/admin/integrations?key=stockbit_refresh_token', { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { key: 'stockbit_refresh_token' } })
  })
})
