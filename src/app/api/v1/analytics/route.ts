export const runtime = 'nodejs'

import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// GET /api/v1/analytics — Pageview analytics overview
// Always public. Returns DAU, MAU, total, and top pages.
// ─────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [dau, mau, total, topPages] = await Promise.all([
      prisma.pageview.count({
        where: { createdAt: { gte: twentyFourHoursAgo } },
      }),
      prisma.pageview.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.pageview.count(),
      prisma.pageview.groupBy({
        by: ['path'],
        _count: { path: true },
        orderBy: { _count: { path: 'desc' } },
        take: 10,
      }),
    ])

    return apiJson({
      dau,
      mau,
      total,
      topPages: topPages.map((p) => ({
        path: p.path,
        count: p._count.path,
      })),
    })
  } catch (err) {
    console.error('[analytics] Failed to fetch:', (err as Error).message)
    return apiJson({ dau: 0, mau: 0, total: 0, topPages: [] })
  }
}