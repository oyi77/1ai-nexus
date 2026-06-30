// ─────────────────────────────────────────────────────────────
// GET /api/v1/news-intel — News & Sentiment Intelligence
// GDELT, SEC EDGAR, exchange status, sentiment aggregation
// Zero API keys — all public endpoints
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchNewsIntelligence, persistNewsEvents } from "@/lib/modules/news/news-intel";

import { fetchSentimentIntelligence, persistSentimentSnapshots } from "@/lib/modules/sentiment/sentiment-intel";
import type { SentimentData } from "@/lib/modules/sentiment/sentiment-intel";

export const dynamic = "force-dynamic";

let cachedNews: unknown = null;
let cachedSentiment: SentimentData[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    const now = Date.now();
    if (action === "news" || action === "all") {
      if (!cachedNews || now - cacheTs > CACHE_TTL) {
        cachedNews = await fetchNewsIntelligence();
        if (cachedNews && typeof cachedNews === 'object' && 'events' in cachedNews) {
          const news = cachedNews as { events: Parameters<typeof persistNewsEvents>[0] }
          persistNewsEvents(news.events).catch(() => {})
        }
        cacheTs = now;
      }
    }

    if (action === "sentiment" || action === "all") {
      if (!cachedSentiment || now - cacheTs > CACHE_TTL) {
        cachedSentiment = await fetchSentimentIntelligence();
        persistSentimentSnapshots(cachedSentiment).catch(() => {})
      }
    }

    const data = action === "news"
      ? { news: cachedNews }
      : action === "sentiment"
      ? { sentiment: cachedSentiment }
      : { news: cachedNews, sentiment: cachedSentiment };

    return cacheHeaders(apiSuccess(data), 300);
  } catch (error) {
    console.error("GET /api/v1/news-intel error:", error);
    return apiError("Failed to fetch news intelligence", 502);
  }
}
