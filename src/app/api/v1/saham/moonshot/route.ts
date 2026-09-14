// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/moonshot — cross-instrument moonshot board.
// Top-10 candidates with confidence >= 70, ranked by expected
// gain per hour x measured hit-rate, across IDX / crypto / LRFg /
// launch / copy-trading / prediction legs.
// Public (market data) — same trust model as watchlist-ideas.
// ─────────────────────────────────────────────────────────────

import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response"
import { getMoonshotBoard } from "@/lib/moonshot/rank"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const board = await getMoonshotBoard()
    return cacheHeaders(apiSuccess(board), 300)
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
