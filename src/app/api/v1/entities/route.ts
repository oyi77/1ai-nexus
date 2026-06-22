import { Prisma } from '@prisma/client'
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, apiPaginated } from "@/lib/api/response";

import { checkRateLimit } from "@/lib/api/rate-limit";

const ENTITY_SORT_FIELDS = new Set(["totalUsdValue", "createdAt", "name", "type"]);

export async function GET(request: NextRequest) {
  try {
    // Public endpoint — auth handled by middleware

    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const { allowed, remaining: _remaining } = await checkRateLimit(ip);
    if (!allowed) return apiError("Rate limit exceeded", 429);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50") || 50));
    const cursor = searchParams.get("cursor");
    const type = searchParams.get("type");
    const chain = searchParams.get("chain");
    const sort = searchParams.get("sort") || "totalUsdValue";
    const order = searchParams.get("order") || "desc";

    if (!ENTITY_SORT_FIELDS.has(sort)) return apiError(`Invalid sort field`, 400);
    if (!["asc", "desc"].includes(order)) return apiError(`Invalid order`, 400);

    const where: Prisma.EntityWhereInput = {}
    if (type) where.type = type;
    if (chain) where.chains = { has: chain };

    const [entities, total] = await Promise.all([
      prisma.entity.findMany({
        where,
        take: pageSize,
        skip: cursor ? 1 : (page - 1) * pageSize,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { [sort]: order },
        include: { wallets: { select: { address: true, chain: true } } },
      }),
      prisma.entity.count({ where }),
    ]);

    const r = apiPaginated(entities, total, page, pageSize);
    r.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return r;
  } catch (error) {
    console.error("GET /api/v1/entities error:", error);
    return apiError("Internal server error", 500);
  }
}