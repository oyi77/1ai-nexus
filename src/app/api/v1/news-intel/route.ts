import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchNewsIntelligence, persistNewsEvents } from "@/lib/modules/news/news-intel";
import { fetchSentimentIntelligence, persistSentimentSnapshots } from "@/lib/modules/sentiment/sentiment-intel";
import { cacheGet } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    let news = await cacheGet<Awaited<ReturnType<typeof fetchNewsIntelligence>>>('news:data')
    let sentiment = await cacheGet<Awaited<ReturnType<typeof fetchSentimentIntelligence>>>('sentiment:data')
    if (!news) news = await fetchNewsIntelligence()
    if (!sentiment) sentiment = await fetchSentimentIntelligence()

    // Persist to DB for backtesting (fire-and-forget)
    if (news?.events?.length > 0) persistNewsEvents(news.events).catch(() => {})
    if (sentiment?.length > 0) persistSentimentSnapshots(sentiment).catch(() => {})

    const data: Record<string, unknown> = {}
    if (action === "news" || action === "all") data.news = news
    if (action === "sentiment" || action === "all") data.sentiment = sentiment
    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/news-intel error:", error);
    return apiError("Failed to fetch news intelligence", 502);
  }
}
