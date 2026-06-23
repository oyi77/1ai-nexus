export const dynamic = "force-dynamic"

import { type NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { checkRateLimit } from "@/lib/api/rate-limit"

// Bulk resolve all open trades for a resolved market
export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    const { allowed } = await checkRateLimit(ip, 10, 60_000)
    if (!allowed) return apiError("Rate limit exceeded", 429)

    const body = await request.json() as {
      marketId?: string
      outcome?: string
    }

    const { marketId, outcome } = body

    if (!marketId) return apiError("marketId is required", 400)
    if (!outcome || (outcome.toUpperCase() !== "YES" && outcome.toUpperCase() !== "NO")) {
      return apiError("outcome must be YES or NO", 400)
    }

    const market = await prisma.predictionMarket.findUnique({ where: { id: marketId } })
    if (!market) return apiError("Market not found", 404)

    // Find all open trades for this market
    const openTrades = await prisma.paperTrade.findMany({
      where: { marketId, status: "open" },
    })

    if (openTrades.length === 0) {
      return apiSuccess({ resolved: 0, message: "No open trades for this market" })
    }

    const resolvedOutcome = outcome.toUpperCase()
    const resolvedPrice = resolvedOutcome === "YES" ? 1.0 : 0.0

    // Resolve each trade
    const results = await Promise.all(
      openTrades.map(trade => {
        const direction = trade.direction === "YES" ? 1 : -1
        // Winner gets $1 per share, loser gets $0
        const pnl = trade.direction === resolvedOutcome
          ? Math.round((1.0 - trade.entryPrice) * trade.shares * 100) / 100
          : Math.round(-trade.entryPrice * trade.shares * 100) / 100

        return prisma.paperTrade.update({
          where: { id: trade.id },
          data: {
            resolvedPrice,
            outcome: resolvedOutcome,
            exitPrice: resolvedPrice,
            status: "resolved",
            pnl,
            closedAt: new Date(),
          },
        })
      })
    )

    // Update market outcome
    await prisma.predictionMarket.update({
      where: { id: marketId },
      data: {
        outcome: resolvedOutcome,
        status: "resolved",
        resolvedAt: new Date(),
      },
    })

    return apiSuccess({
      resolved: results.length,
      outcome: resolvedOutcome,
      totalPnl: results.reduce((sum, t) => sum + t.pnl, 0),
    })
  } catch (error) {
    console.error("POST /api/v1/paper-trades/resolve error:", error)
    return apiError("Internal server error", 500)
  }
}
