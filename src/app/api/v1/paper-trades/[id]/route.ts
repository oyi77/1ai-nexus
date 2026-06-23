export const dynamic = "force-dynamic"

import { type NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { checkRateLimit } from "@/lib/api/rate-limit"

// Close a paper trade (manual exit)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    const { allowed } = await checkRateLimit(ip, 30, 60_000)
    if (!allowed) return apiError("Rate limit exceeded", 429)

    const { id } = await params
    const body = await request.json() as {
      exitPrice?: number
      outcome?: string
      notes?: string
    }

    const existing = await prisma.paperTrade.findUnique({ where: { id } })
    if (!existing) return apiError("Trade not found", 404)
    if (existing.status !== "open") return apiError("Trade is already closed", 400)

    const { exitPrice, outcome, notes } = body

    if (exitPrice == null || exitPrice <= 0 || exitPrice >= 1) {
      return apiError("exitPrice must be between 0 and 1", 400)
    }

    // Calculate PnL: (exitPrice - entryPrice) * shares for YES, flipped for NO
    const direction = existing.direction === "YES" ? 1 : -1
    const pnl = Math.round((exitPrice - existing.entryPrice) * existing.shares * direction * 100) / 100

    const trade = await prisma.paperTrade.update({
      where: { id },
      data: {
        exitPrice: Math.round(exitPrice * 10000) / 10000,
        outcome: outcome || null,
        status: "closed",
        pnl,
        notes: notes ?? existing.notes,
        closedAt: new Date(),
      },
      include: {
        market: {
          select: {
            id: true,
            category: true,
            symbol: true,
            status: true,
          },
        },
      },
    })

    return apiSuccess(trade)
  } catch (error) {
    console.error("PATCH /api/v1/paper-trades/[id] error:", error)
    return apiError("Internal server error", 500)
  }
}

// Delete a paper trade
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await prisma.paperTrade.findUnique({ where: { id } })
    if (!existing) return apiError("Trade not found", 404)

    await prisma.paperTrade.delete({ where: { id } })

    return apiSuccess({ deleted: true })
  } catch (error) {
    console.error("DELETE /api/v1/paper-trades/[id] error:", error)
    return apiError("Internal server error", 500)
  }
}
