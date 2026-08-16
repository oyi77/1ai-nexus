export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import * as lunarcrush from "@/lib/lunarcrush";

const X_API_BEARER_TOKEN = process.env.X_API_BEARER_TOKEN ?? "";

const TRACKED_ASSETS = [
  "BTC", "ETH", "SOL", "ARB", "OP", "BASE", "MATIC", "AVAX", "DOT", "LINK",
  "UNI", "AAVE", "MKR", "CRV", "LDO", "GMX", "GNS", "SNX", "YFI", "BAL",
] as const;

interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
  };
  entities?: {
    cashtags?: Array<{ tag: string }>;
    hashtags?: Array<{ tag: string }>;
  };
}

interface XSearchResponse {
  data: XTweet[];
  meta: { result_count: number; next_token?: string };
}

async function searchXCashtag(asset: string, maxResults: number = 50): Promise<XTweet[]> {
  if (!X_API_BEARER_TOKEN) return [];

  const query = `$${asset} OR #${asset} OR ${asset} crypto`;
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${maxResults}&tweet.fields=public_metrics,created_at,entities,author_id`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${X_API_BEARER_TOKEN}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`X API ${res.status}`);
    const response = (await res.json()) as XSearchResponse;
    return response.data ?? [];
  } catch (err) {
    console.error(`[sentiment:x] search failed for ${asset}:`, (err as Error).message);
    return [];
  }
}

function analyzeTweets(tweets: XTweet[]): {
  bullish: number;
  bearish: number;
  neutral: number;
  engagement: number;
} {
  const bullishKeywords = [
    "bullish", "moon", "pump", "buy", "long", "accumulate", "support",
    "breakout", "rally", "surge", "gains", "profit", "hodl", "diamond hands",
  ];
  const bearishKeywords = [
    "bearish", "dump", "sell", "short", "crash", "drop", "fall", "resistance",
    "correction", "liquidation", "rekt", "paper hands", "exit", "top",
  ];

  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let totalEngagement = 0;

  for (const tweet of tweets) {
    const text = tweet.text.toLowerCase();
    const engagement =
      tweet.public_metrics.like_count +
      tweet.public_metrics.retweet_count * 2 +
      tweet.public_metrics.reply_count;

    totalEngagement += engagement;

    const isBullish = bullishKeywords.some((k) => text.includes(k));
    const isBearish = bearishKeywords.some((k) => text.includes(k));

    if (isBullish && !isBearish) bullish++;
    else if (isBearish && !isBullish) bearish++;
    else neutral++;
  }

  return { bullish, bearish, neutral, engagement: totalEngagement };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action") ?? "x";
    const asset = searchParams.get("asset") ?? "BTC";
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const assets = searchParams.get("assets") ?? "BTC,ETH,SOL";

    switch (action) {
      case "x": {
        if (!X_API_BEARER_TOKEN) return apiError("X_API_BEARER_TOKEN not configured", 503);

        const tweets = await searchXCashtag(asset, limit);
        if (tweets.length === 0) {
          return apiSuccess({
            asset,
            tweetCount: 0,
            bullish: 0,
            bearish: 0,
            neutral: 0,
            engagement: 0,
            score: 0,
            label: "neutral",
            topTweets: [],
          });
        }

        const { bullish, bearish, neutral, engagement } = analyzeTweets(tweets);
        const total = bullish + bearish + neutral;
        const score = total > 0 ? (bullish - bearish) / total : 0;
        const label = bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "neutral";

        const r = apiSuccess({
          asset,
          tweetCount: tweets.length,
          bullish,
          bearish,
          neutral,
          engagement,
          score,
          label,
          topTweets: tweets.slice(0, 5).map((t) => ({
            id: t.id,
            text: t.text.slice(0, 200),
            authorId: t.author_id,
            engagement: t.public_metrics.like_count + t.public_metrics.retweet_count,
            createdAt: t.created_at,
          })),
        });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "lunarcrush": {
        const symbols = assets.split(",").map((s) => s.trim().toUpperCase());
        const data = await lunarcrush.getCoinMetrics(symbols[0]); // LunarCrush client only does single coin

        const results = [];
        for (const sym of symbols.slice(0, 10)) {
          try {
            const coin = await lunarcrush.getCoinMetrics(sym);
            results.push({
              asset: sym,
              galaxyScore: coin.galaxy_score,
              altRank: coin.alt_rank,
              sentimentScore: coin.sentiment,
              bullishPct: Math.max(0, Math.min(100, 50 + (coin.percent_change_24h ?? 0) * 0.5)),
              socialVolume: coin.social_volume_24h,
              socialDominance: coin.social_dominance,
              price: coin.price,
              priceChange24h: coin.percent_change_24h,
              marketCap: coin.market_cap,
              volume24h: coin.volume_24h,
            });
          } catch {
            // Skip failed assets
          }
        }

        const r = apiSuccess(results, { total: results.length });
        r.headers.set("Cache-Control", "public, max-age=900, stale-while-revalidate=1800");
        return r;
      }

      case "aggregated": {
        if (!X_API_BEARER_TOKEN) return apiError("X_API_BEARER_TOKEN not configured", 503);

        const assetUpper = asset.toUpperCase();

        // Get X sentiment
        const xTweets = await searchXCashtag(assetUpper, 50);
        const xSentiment = xTweets.length > 0 ? analyzeTweets(xTweets) : { bullish: 0, bearish: 0, neutral: 0 };
        const xScore = (xSentiment.bullish + xSentiment.bearish + xSentiment.neutral) > 0
          ? (xSentiment.bullish - xSentiment.bearish) / (xSentiment.bullish + xSentiment.bearish + xSentiment.neutral)
          : 0;

        // Get LunarCrush sentiment
        let lunarScore = 0;
        try {
          const coin = await lunarcrush.getCoinMetrics(assetUpper);
          lunarScore = (coin.galaxy_score - 50) / 50; // Normalize to -1..1
        } catch {
          // LunarCrush not available
        }

        // Combine: weight X higher (0.6) for recency
        const combined = xScore * 0.6 + lunarScore * 0.4;
        const label = combined > 0.15 ? "bullish" : combined < -0.15 ? "bearish" : "neutral";
        const confidence = Math.min(1, xTweets.length * 0.02);

        const r = apiSuccess({
          asset: assetUpper,
          xScore,
          lunarScore,
          combined,
          label,
          confidence,
          xDetails: {
            tweetCount: xTweets.length,
            bullish: xSentiment.bullish,
            bearish: xSentiment.bearish,
            neutral: xSentiment.neutral,
          },
        });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "health": {
        const xOk = !!X_API_BEARER_TOKEN;
        const lunarOk = (await lunarcrush.healthCheck()).ok;
        const r = apiSuccess({ xAvailable: xOk, lunarAvailable: lunarOk });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      default:
        return apiError(
          `Unknown action: ${action}. Use: x, lunarcrush, aggregated, health`,
          400
        );
    }
  } catch (error) {
    console.error("GET /api/v1/sentiment error:", error);
    return apiError("Sentiment request failed", 502);
  }
}