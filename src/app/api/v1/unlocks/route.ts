// ─────────────────────────────────────────────────────────────
// GET /api/v1/unlocks — Token Unlock Calendar
// Upcoming token unlocks from public schedule data
// Zero API keys — all from maintained registry
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchUnlockEvents, persistUnlockEvents } from "@/lib/modules/calendar/unlock-calendar";

export const dynamic = "force-dynamic";

let cachedEvents: unknown = null;
let cacheTs = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (!cachedEvents || now - cacheTs > CACHE_TTL) {
      cachedEvents = await fetchUnlockEvents();
      cacheTs = now;
      // Persist to DB for backtesting (fire-and-forget)
      if ((cachedEvents as unknown[])?.length > 0) persistUnlockEvents(cachedEvents as Parameters<typeof persistUnlockEvents>[0]).catch(() => {})
    }
    return cacheHeaders(apiSuccess({ unlocks: cachedEvents, count: (cachedEvents as unknown[])?.length ?? 0 }), 3600);
  } catch (error) {
    console.error("GET /api/v1/unlocks error:", error);
    return apiError("Failed to fetch unlock events", 502);
  }
}
