export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { validateApiKey } from "@/lib/api/auth";
import { getUsage } from "@/lib/usage-tracking";

export async function GET(request: NextRequest) {
  try {
    if (!validateApiKey(request)) {
      return cacheHeaders(apiError("Invalid or missing API key", 401), 10);
    }

    const key = request.headers.get("authorization")!.slice(7);
    const usage = getUsage(key);

    if (!usage) {
      return cacheHeaders(apiSuccess({
        totalCalls: 0,
        lastCalledAt: null,
        endpoints: {},
        message: "No usage recorded yet for this API key",
      }), 10);
    }

    return cacheHeaders(apiSuccess({
      totalCalls: usage.totalCalls,
      lastCalledAt: new Date(usage.lastCalledAt).toISOString(),
      endpoints: usage.endpoints,
      topEndpoints: Object.entries(usage.endpoints)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([endpoint, count]) => ({ endpoint, count })),
    }), 10);
  } catch (error) {
    console.error("GET /api/v1/usage error:", error);
    return cacheHeaders(apiError("Failed to fetch usage", 500), 10);
  }
}
