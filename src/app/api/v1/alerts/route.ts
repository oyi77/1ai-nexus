export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withApiAuth } from "@/lib/api/with-api-auth";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get("userId");
    const isActive = searchParams.get("active");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50") || 50));

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (isActive !== null) where.isActive = isActive === "true";

    const [data, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      prisma.alert.count({ where }),
    ]);

    return cacheHeaders(apiSuccess(data, { total, page, pageSize, hasMore: page * pageSize < total }), 10);
  } catch (error) {
    console.error("GET /api/v1/alerts error:", error);
    return cacheHeaders(apiError("Internal server error", 500), 10);
  }
}

export const POST = withApiAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { userId, triggerType, conditions } = body;

    if (!userId || !triggerType || !conditions) {
      return apiError("Missing required fields: userId, triggerType, conditions");
    }

    const alert = await prisma.alert.create({
      data: { userId, triggerType, conditions },
    });

    return apiSuccess(alert);
  } catch (error) {
    console.error("POST /api/v1/alerts error:", error);
    return apiError("Internal server error", 500);
  }
});
