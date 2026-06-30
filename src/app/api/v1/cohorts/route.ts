// ─────────────────────────────────────────────────────────────
// GET /api/v1/cohorts — Smart Money Cohort Intelligence
// Real behavioral cohorts computed from Prisma DB
// Zero hardcoded data — all computed from transaction history
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { getCohorts, getCohortSignals } from "@/lib/modules/derived/cohort-engine";

export const dynamic = "force-dynamic";

// Cache cohorts for 5 minutes (DB queries are expensive)
let cachedCohorts: unknown = null;
let cachedSignals: unknown = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    const now = Date.now();

    if (action === "cohorts" || action === "all") {
      if (!cachedCohorts || now - cacheTs > CACHE_TTL) {
        cachedCohorts = await getCohorts();
        cacheTs = now;
      }
    }

    if (action === "signals" || action === "all") {
      if (!cachedSignals || now - cacheTs > CACHE_TTL) {
        cachedSignals = await getCohortSignals();
        cacheTs = now;
      }
    }

    const data = action === "cohorts"
      ? { cohorts: cachedCohorts }
      : action === "signals"
      ? { signals: cachedSignals }
      : { cohorts: cachedCohorts, signals: cachedSignals };

    return cacheHeaders(apiSuccess(data), 300);
  } catch (error) {
    console.error("GET /api/v1/cohorts error:", error);
    return apiError("Internal server error", 500);
  }
}
