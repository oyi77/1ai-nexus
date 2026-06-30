// ─────────────────────────────────────────────────────────────
// GET /api/v1/news-intel — News & Sentiment Intelligence
// Reads from sharedCache (background-refreshed), falls back to live fetch
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchNewsIntelligence } from "@/lib/modules/news/news-intel";
import { fetchSentimentIntelligence } from "@/lib/modules/sentiment/sentiment-intel";
import { sharedCache } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";

    let news = sharedCache.get<Awaited<ReturnType<typeof fetchNewsIntelligence>>>('news:data')
    let sentiment = sharedCache.get<Awaited<ReturnType<typeof fetchSentimentIntelligence>>>('sentiment:data')

    if (!news) news = await fetchNewsIntelligence()
    if (!sentiment) sentiment = await fetchSentimentIntelligence()

    const data: Record<string, unknown> = {}
    if (action === "news" || action === "all") data.news = news
    if (action === "sentiment" || action === "all") data.sentiment = sentiment

    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/news-intel error:", error);
    return apiError("Failed to fetch news intelligence", 502);
  }
}
