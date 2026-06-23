export const dynamic = "force-dynamic"

import { type NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { checkRateLimit } from "@/lib/api/rate-limit"

export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    const { allowed } = await checkRateLimit(ip)
    if (!allowed) return apiError("Rate limit exceeded", 429)

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId") || "default"

    const [openTrades, closedTrades, allTrades] = await Promise.all([
      prisma.paperTrade.findMany({
        where: { userId, status: "open" },
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
        orderBy: { createdAt: "desc" },
      }),
      prisma.paperTrade.findMany({
        where: { userId, status: { in: ["closed", "resolved"] } },
        orderBy: { closedAt: "desc" },
        take: 100,
      }),
      prisma.paperTrade.findMany({
        where: { userId },
        select: { pnl: true, status: true, direction: true, shares: true, entryPrice: true, outcome: true },
      }),
    ])

    const totalPnl = allTrades.reduce((sum, t) => sum + t.pnl, 0)
    const closedOnly = allTrades.filter(t => t.status !== "open")
    const wins = closedOnly.filter(t => t.pnl > 0).length
    const losses = closedOnly.filter(t => t.pnl < 0).length
    const resolved = closedOnly.length
    const winRate = resolved > 0 ? (wins / resolved) * 100 : 0

    // Capital deployed in open trades
    const capitalDeployed = openTrades.reduce((sum, t) => sum + t.shares * t.entryPrice, 0)

    // Unrealized P&L estimate (using market average as proxy)
    const unrealizedPnl = openTrades.reduce((sum, t) => {
      // Simple mark-to-market: if YES, gain when price rises; if NO, gain when price falls
      const priceDelta = 0.5 - t.entryPrice // Use midpoint as rough mark
      const direction = t.direction === "YES" ? 1 : -1
      return sum + (t.shares * priceDelta * direction)
    }, 0)

    const avgPnl = resolved > 0 ? totalPnl / resolved : 0
    const bestTrade = closedOnly.length > 0 ? Math.max(...closedOnly.map(t => t.pnl)) : 0
    const worstTrade = closedOnly.length > 0 ? Math.min(...closedOnly.map(t => t.pnl)) : 0

    // Category breakdown
    const categoryBreakdown: Record<string, { count: number; pnl: number }> = {}
    for (const trade of allTrades) {
      const cat = "Unknown"
      if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { count: 0, pnl: 0 }
      categoryBreakdown[cat].count++
      categoryBreakdown[cat].pnl += trade.pnl
    }

    // Direction breakdown
    const yesTrades = allTrades.filter(t => t.direction === "YES")
    const noTrades = allTrades.filter(t => t.direction === "NO")

    const stats = {
      totalTrades: allTrades.length,
      openTrades: openTrades.length,
      closedTrades: resolved,
      wins,
      losses,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      avgPnl: Math.round(avgPnl * 100) / 100,
      bestTrade: Math.round(bestTrade * 100) / 100,
      worstTrade: Math.round(worstTrade * 100) / 100,
      capitalDeployed: Math.round(capitalDeployed * 100) / 100,
      directionBreakdown: {
        yes: { count: yesTrades.length, pnl: Math.round(yesTrades.reduce((s, t) => s + t.pnl, 0) * 100) / 100 },
        no: { count: noTrades.length, pnl: Math.round(noTrades.reduce((s, t) => s + t.pnl, 0) * 100) / 100 },
      },
      categoryBreakdown,
      recentOpen: openTrades.slice(0, 10),
      recentClosed: closedTrades.slice(0, 10),
    }

    const r = apiSuccess(stats)
    r.headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    return r
  } catch (error) {
    console.error("GET /api/v1/paper-trades/stats error:", error)
    return apiError("Internal server error", 500)
  }
}
