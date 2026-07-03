// ─────────────────────────────────────────────────────────────
// GET /api/v1/bonds — US Treasury yields (proxied)
// Fetches from treasury.gov server-side so client never hits external URLs
// ─────────────────────────────────────────────────────────────

import { apiSuccess, cacheHeaders } from "@/lib/api/response";
import { fetchGraceful } from "@/lib/api/fetch-utils";

export const dynamic = "force-dynamic";

let cached: { csv: string } | null = null;
let cacheTs = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour — treasury rates update daily

export async function GET() {
  const now = Date.now();
  if (!cached || now - cacheTs > CACHE_TTL) {
    const result = await fetchGraceful(
      async () => {
        const res = await fetch(
          'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv',
          { signal: AbortSignal.timeout(15_000) }
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
      },
      ""
    );

    if (result.success) {
      cached = { csv: result.data };
      cacheTs = now;
    } else {
      console.error("GET /api/v1/bonds error:", result.error);
    }
  }

  return cacheHeaders(apiSuccess(cached ?? { csv: "" }), 3600);
}
