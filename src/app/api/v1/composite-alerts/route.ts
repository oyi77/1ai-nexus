import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { evaluateCompositeSignals } from "@/lib/modules/derived/composite-signals";
import { cacheGet } from "@/lib/cache"

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let signals = await cacheGet<Awaited<ReturnType<typeof evaluateCompositeSignals>>>('composite:signals')
    if (!signals) signals = await evaluateCompositeSignals()
    return cacheHeaders(apiSuccess({ signals }), 15);
  } catch (error) {
    console.error("GET /api/v1/composite-alerts error:", error);
    return apiError("Failed to evaluate composite signals", 502);
  }
}
