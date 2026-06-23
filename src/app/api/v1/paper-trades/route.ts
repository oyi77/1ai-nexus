import { Prisma } from '@prisma/client'
export const dynamic = "force-dynamic"

import { type NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, apiPaginated } from "@/lib/api/response"
import { checkRateLimit } from "@/lib/api/rate-limit"

const SORT_FIELDS: Record<string, true> = { createdAt: true, entryPrice: true, shares: true, pnl: true, closedAt: true }

export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    const { allowed } = await checkRateLimit(ip)
    if (!allowed) return apiError("Rate limit exceeded", 429)

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50") || 50))
    const status = searchParams.get("status")
    const userId = searchParams.get("userId") || "default"
    const sort = searchParams.get("sort") || "createdAt"
    const order = searchParams.get("order") || "desc"

    if (!SORT_FIELDS[sort]) return apiError("Invalid sort field", 400)
    if (order !== "asc" && order !== "desc") return apiError("Invalid order", 400)

    const where: Prisma.PaperTradeWhereInput = { userId }
    if (status) where.status = status

    const [trades, total] = await Promise.all([
      prisma.paperTrade.findMany({
        where,
        include: {
          market: {
            select: {
              id: true,
              category: true,
              symbol: true,
              status: true,
              volume24h: true,
              totalVolume: true,
              outcome: true,
            },
          },
        },
        take: pageSize,
        skip: (page - 1) * pageSize,
        orderBy: { [sort]: order },
      }),
      prisma.paperTrade.count({ where }),
    ])

    const r = apiPaginated(trades, total, page, pageSize)
    r.headers.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=20')
    return r
  } catch (error) {
    console.error("GET /api/v1/paper-trades error:", error)
    return apiError("Internal server error", 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    const { allowed } = await checkRateLimit(ip, 30, 60_000)
    if (!allowed) return apiError("Rate limit exceeded", 429)

    const body = await request.json() as {
      marketId?: string
      direction?: string
      shares?: number
      entryPrice?: number
      notes?: string
    }

    const { marketId, direction, shares, entryPrice, notes } = body

    if (!marketId) return apiError("marketId is required", 400)
    if (!direction || (direction.toUpperCase() !== "YES" && direction.toUpperCase() !== "NO")) {
      return apiError("direction must be YES or NO", 400)
    }
    if (!shares || shares <= 0) return apiError("shares must be positive", 400)
    if (entryPrice == null || entryPrice <= 0 || entryPrice >= 1) {
      return apiError("entryPrice must be between 0 and 1", 400)
    }

    const market = await prisma.predictionMarket.findUnique({ where: { id: marketId } })
    if (!market) return apiError("Market not found", 404)
    if (market.status !== "open") return apiError("Market is not open for trading", 400)

    const trade = await prisma.paperTrade.create({
      data: {
        marketId,
        userId: "default",
        direction: direction.toUpperCase(),
        shares: Math.round(shares * 100) / 100,
        entryPrice: Math.round(entryPrice * 10000) / 10000,
        notes: notes || null,
      },
      include: {
        market: {
          select: {
            id: true,
            category: true,
            symbol: true,
            status: true,
            volume24h: true,
            totalVolume: true,
          },
        },
      },
    })

    const r = apiSuccess(trade)
    r.headers.set('Cache-Control', 'no-store')
    return r
  } catch (error) {
    console.error("POST /api/v1/paper-trades error:", error)
    return apiError("Internal server error", 500)
  }
}
