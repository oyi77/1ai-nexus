// ─────────────────────────────────────────────────────────────
// GET /api/v1/composite-alerts — Cross-module compound signals
// Reads from sharedCache (background-refreshed), falls back to live fetch
// ─────────────────────────────────────────────────────────────

import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { evaluateCompositeSignals } from "@/lib/modules/derived/composite-signals";
import { sharedCache } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let signals = sharedCache.get<Awaited<ReturnType<typeof evaluateCompositeSignals>>>('composite:signals')
    if (!signals) signals = await evaluateCompositeSignals()

    return cacheHeaders(apiSuccess({ signals }), 15);
  } catch (error) {
    console.error("GET /api/v1/composite-alerts error:", error);
    return apiError("Failed to evaluate composite signals", 502);
  }
}
