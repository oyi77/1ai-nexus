import { Prisma } from '@prisma/client'
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, apiPaginated } from "@/lib/api/response";

import { checkRateLimit } from "@/lib/api/rate-limit";

const PREDICTION_SORT_FIELDS = new Set(["volume24h", "totalVolume", "createdAt", "traderCount", "yesPrice", "noPrice"]);

export async function GET(request: NextRequest) {
  try {
    // Public endpoint — auth handled by middleware

    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const { allowed } = await checkRateLimit(ip);
    if (!allowed) return apiError("Rate limit exceeded", 429);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50") || 50));
    const category = searchParams.get("category");
    const status = searchParams.get("status") || "open";
    const sort = searchParams.get("sort") || "volume24h";
    const order = searchParams.get("order") || "desc";

    if (!PREDICTION_SORT_FIELDS.has(sort)) return apiError(`Invalid sort field`, 400);
    if (!["asc", "desc"].includes(order)) return apiError(`Invalid order`, 400);

    const where: Prisma.PredictionMarketWhereInput = { status };
    if (category) where.category = category;

    const [markets, total] = await Promise.all([
      prisma.predictionMarket.findMany({
        where,
        take: pageSize,
        skip: (page - 1) * pageSize,
        orderBy: { [sort]: order },
      }),
      prisma.predictionMarket.count({ where }),
    ]);

    const r = apiPaginated(markets, total, page, pageSize);
    r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    return r;
  } catch (error) {
    console.error("GET /api/v1/predictions error:", error);
    return apiError("Internal server error", 500);
  }
}
