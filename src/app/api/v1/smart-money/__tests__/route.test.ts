import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { GET } from '../route'

vi.mock('@/lib/db', () => ({
  prisma: {
    smartMoneyWallet: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('@/lib/api/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}))
describe('GET /api/v1/smart-money', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 99 })
    vi.mocked(prisma.smartMoneyWallet.findMany).mockResolvedValue([])
    vi.mocked(prisma.smartMoneyWallet.count).mockResolvedValue(0)
  })

  it('returns 200 with default params', async () => {
    const req = new NextRequest('http://localhost/api/v1/smart-money')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.error).toBeNull()
    expect(json.data).toEqual([])
    expect(json.meta).toEqual({
      page: 1,
      pageSize: 50,
      total: 0,
      hasMore: false,
    })

    expect(prisma.smartMoneyWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        take: 50,
        skip: 0,
        orderBy: { score: 'desc' },
      })
    )
    expect(prisma.smartMoneyWallet.count).toHaveBeenCalledWith({ where: {} })
  })

  it.each(['pnl30d', 'winRate', 'status', 'sampleCount', 'classifiedAt', 'score', 'addedAt', 'category'])(
    'sorting by %s succeeds and does not return 400',
    async (field) => {
      const req = new NextRequest(`http://localhost/api/v1/smart-money?sort=${field}&order=asc`)
      const res = await GET(req)

      expect(res.status).toBe(200)
      expect(prisma.smartMoneyWallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { [field]: 'asc' },
        })
      )
    }
  )

  it('invalid sort field returns 400', async () => {
    const req = new NextRequest('http://localhost/api/v1/smart-money?sort=invalid_column')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Invalid sort field/)
    expect(prisma.smartMoneyWallet.findMany).not.toHaveBeenCalled()
  })

  it('invalid order returns 400', async () => {
    const req = new NextRequest('http://localhost/api/v1/smart-money?order=sideways')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Invalid order/)
    expect(prisma.smartMoneyWallet.findMany).not.toHaveBeenCalled()
  })

  it('status filter parameter maps to Prisma where clause', async () => {
    // 1. status=all -> should not set where.status
    const reqAll = new NextRequest('http://localhost/api/v1/smart-money?status=all')
    const resAll = await GET(reqAll)
    expect(resAll.status).toBe(200)
    expect(prisma.smartMoneyWallet.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {},
      })
    )

    // 2. status=classified -> where.status = { not: null }
    const reqClassified = new NextRequest('http://localhost/api/v1/smart-money?status=classified')
    const resClassified = await GET(reqClassified)
    expect(resClassified.status).toBe(200)
    expect(prisma.smartMoneyWallet.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: { not: null } },
      })
    )

    // 3. status=QUALIFIED_SMART_MONEY -> where.status = 'QUALIFIED_SMART_MONEY'
    const reqQualified = new NextRequest('http://localhost/api/v1/smart-money?status=QUALIFIED_SMART_MONEY')
    const resQualified = await GET(reqQualified)
    expect(resQualified.status).toBe(200)
    expect(prisma.smartMoneyWallet.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: 'QUALIFIED_SMART_MONEY' },
      })
    )

    // 4. status=WHALE -> where.status = 'WHALE'
    const reqWhale = new NextRequest('http://localhost/api/v1/smart-money?status=WHALE')
    const resWhale = await GET(reqWhale)
    expect(resWhale.status).toBe(200)
    expect(prisma.smartMoneyWallet.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: 'WHALE' },
      })
    )
  })

  it('chain and minScore filter parameters map to Prisma where clause', async () => {
    const req = new NextRequest('http://localhost/api/v1/smart-money?chain=solana&minScore=75.5')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(prisma.smartMoneyWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          wallet: { is: { chain: 'solana' } },
          score: { gte: 75.5 },
        },
      })
    )
  })

  it('rate limit exceeded returns 429', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0 })
    const req = new NextRequest('http://localhost/api/v1/smart-money')
    const res = await GET(req)

    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error).toMatch(/Rate limit exceeded/)
    expect(prisma.smartMoneyWallet.findMany).not.toHaveBeenCalled()
  })
})
