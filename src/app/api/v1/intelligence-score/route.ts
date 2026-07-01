// ─────────────────────────────────────────────────────────────
// GET /api/v1/intelligence-score — Unified Intelligence Score
// Combines all 14 modules into a single 0-100 score
// ─────────────────────────────────────────────────────────────

import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { computeIntelligenceScore } from "@/lib/modules/derived/intelligence-score";

export const dynamic = "force-dynamic";

let cachedScore: unknown = null;
let cacheTs = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

export async function GET() {
  try {
    const now = Date.now();
    if (!cachedScore || now - cacheTs > CACHE_TTL) {
      cachedScore = await computeIntelligenceScore();
      cacheTs = now;
    }
    return cacheHeaders(apiSuccess(cachedScore), 60);
  } catch (error) {
    console.error("GET /api/v1/intelligence-score error:", error);
    return apiError("Failed to compute intelligence score", 502);
  }
}
