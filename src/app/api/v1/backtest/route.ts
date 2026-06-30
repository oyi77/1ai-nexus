// ─────────────────────────────────────────────────────────────
// GET /api/v1/backtest — Historical signal accuracy backtest
// Replays persisted snapshots vs actual BTC price outcomes
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import { runBacktest } from "@/lib/modules/derived/backtest-engine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const days = parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10)
    const report = await runBacktest(Math.min(90, Math.max(7, days)))
    return apiSuccess(report)
  } catch (error) {
    console.error("GET /api/v1/backtest error:", error)
    return apiError("Failed to run backtest", 502)
  }
}
