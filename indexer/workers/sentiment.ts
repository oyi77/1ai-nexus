// ─────────────────────────────────────────────────────────────
// Sentiment Worker — Social Intelligence Layer
// X API v2 (Twitter) + LunarCrush for crypto sentiment
// Outputs: SentimentSnapshot, asset-level sentiment scores
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db";
import { publishEvent } from "../publisher";
import { fetchWithRetry } from "../integrations/http-client";
import { type IntegrationConfig } from "../integrations/config";

const SENTIMENT_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const LUNARCRUSH_SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Tracked crypto assets for sentiment
const TRACKED_ASSETS = [
  "BTC", "ETH", "SOL", "ARB", "OP", "BASE", "MATIC", "AVAX", "DOT", "LINK",
  "UNI", "AAVE", "MKR", "CRV", "LDO", "GMX", "GNS", "SNX", "YFI", "BAL",
] as const;

interface LunarCrushAsset {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  market_cap: number;
  volume_24h: number;
  price: number;
  price_change_24h: number;
  galaxy_score: number;
  alt_rank: number;
  social_volume_24h: number;
  social_dominance: number;
  sentiment_score: number;
  bullish_pct: number;
  bearish_pct: number;
  tweets_24h: number;
  reddit_posts_24h: number;
  reddit_comments_24h: number;
  github_commits_24h: number;
  github_stars: number;
  github_forks: number;
}

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

/**
 * Start the sentiment worker
 * Runs continuous loops for X API and LunarCrush
 */
export function startSentimentWorker(config: IntegrationConfig): void {
  console.log("[sentiment] starting sentiment worker");

  const xApiKey = process.env.X_API_BEARER_TOKEN;
  const lunarCrushKey = process.env.LUNARCRUSH_API_KEY;

  if (!xApiKey && !lunarCrushKey) {
    console.log("[sentiment] No API keys configured (X_API_BEARER_TOKEN, LUNARCRUSH_API_KEY)");
    return;
  }

  if (xApiKey) {
    console.log("[sentiment] X API loop started (every 5min)");
    runXSentimentLoop(config, xApiKey);
  }

  if (lunarCrushKey) {
    console.log("[sentiment] LunarCrush loop started (every 15min)");
    runLunarCrushLoop(config, lunarCrushKey);
  }
}

/**
 * X API v2 sentiment loop
 * Searches for crypto cashtags and computes sentiment
 */
async function runXSentimentLoop(config: IntegrationConfig, bearerToken: string): Promise<void> {
  try {
    await fetchXSentiment(config, bearerToken);
  } catch (err) {
    console.error("[sentiment:x] loop error:", (err as Error).message);
  }

  setTimeout(() => runXSentimentLoop(config, bearerToken), SENTIMENT_SYNC_INTERVAL);
}

async function fetchXSentiment(config: IntegrationConfig, bearerToken: string): Promise<void> {
  const results: Array<{
    asset: string;
    tweetCount: number;
    bullish: number;
    bearish: number;
    neutral: number;
    engagement: number;
    topTweets: XTweet[];
  }> = [];

  // Search for each asset's cashtag
  for (const asset of TRACKED_ASSETS) {
    try {
      const tweets = await searchXCashtag(bearerToken, asset, 50);
      if (tweets.length === 0) continue;

      const { bullish, bearish, neutral, engagement } = analyzeTweets(tweets);

      results.push({
        asset,
        tweetCount: tweets.length,
        bullish,
        bearish,
        neutral,
        engagement,
        topTweets: tweets.slice(0, 5),
      });

      // Store per-asset sentiment snapshot
      await prisma.sentimentSnapshot.create({
        data: {
          source: "x",
          score: (bullish - bearish) / Math.max(1, bullish + bearish + neutral),
          label: bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "neutral",
          metadata: {
            asset,
            tweetCount: tweets.length,
            bullish,
            bearish,
            neutral,
            engagement,
            topTweets: tweets.slice(0, 3).map((t) => ({
              id: t.id,
              text: t.text.slice(0, 200),
              authorId: t.author_id,
              engagement: t.public_metrics.like_count + t.public_metrics.retweet_count,
            })),
          },
        },
      });
    } catch (err) {
      console.error(`[sentiment:x] failed for ${asset}:`, (err as Error).message);
    }
  }

  // Publish aggregate sentiment event
  if (results.length > 0) {
    await publishEvent("nexus:sentiment", {
      source: "x",
      type: "asset_sentiment",
      assets: results,
      timestamp: new Date().toISOString(),
    });
    console.log(`[sentiment:x] published sentiment for ${results.length} assets`);
  }
}

async function searchXCashtag(
  bearerToken: string,
  asset: string,
  maxResults: number = 50
): Promise<XTweet[]> {
  const query = `$${asset} OR #${asset} OR ${asset} crypto`;
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${maxResults}&tweet.fields=public_metrics,created_at,entities,author_id`;

  try {
    const response = await fetchWithRetry<XSearchResponse>(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      maxRetries: 2,
      timeoutMs: 15_000,
    });
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

/**
 * LunarCrush sentiment loop
 * Provides Galaxy Score, AltRank, social metrics
 */
async function runLunarCrushLoop(config: IntegrationConfig, apiKey: string): Promise<void> {
  try {
    await fetchLunarCrushSentiment(config, apiKey);
  } catch (err) {
    console.error("[sentiment:lunar] loop error:", (err as Error).message);
  }

  setTimeout(() => runLunarCrushLoop(config, apiKey), LUNARCRUSH_SYNC_INTERVAL);
}

async function fetchLunarCrushSentiment(config: IntegrationConfig, apiKey: string): Promise<void> {
  const symbols = TRACKED_ASSETS.join(",");
  const url = `https://api.lunarcrush.com/v2?data=assets&key=${apiKey}&symbol=${symbols}&interval=24h`;

  try {
    const response = await fetchWithRetry<{ data: LunarCrushAsset[] }>(url, {
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    const assets = response.data ?? [];
    const results = [];

    for (const asset of assets) {
      // Store LunarCrush snapshot
      await prisma.sentimentSnapshot.create({
        data: {
          source: "lunarcrush",
          score: (asset.galaxy_score - 50) / 50, // Normalize to -1..1
          label:
            asset.galaxy_score > 60 ? "bullish" : asset.galaxy_score < 40 ? "bearish" : "neutral",
          metadata: {
            asset: asset.symbol,
            galaxyScore: asset.galaxy_score,
            altRank: asset.alt_rank,
            socialVolume: asset.social_volume_24h,
            socialDominance: asset.social_dominance,
            sentimentScore: asset.sentiment_score,
            bullishPct: asset.bullish_pct,
            bearishPct: asset.bearish_pct,
            tweets24h: asset.tweets_24h,
            price: asset.price,
            priceChange24h: asset.price_change_24h,
            marketCap: asset.market_cap,
            volume24h: asset.volume_24h,
          },
        },
      });

      results.push({
        asset: asset.symbol,
        galaxyScore: asset.galaxy_score,
        altRank: asset.alt_rank,
        sentimentScore: asset.sentiment_score,
        bullishPct: asset.bullish_pct,
      });
    }

    if (results.length > 0) {
      await publishEvent("nexus:sentiment", {
        source: "lunarcrush",
        type: "galaxy_scores",
        assets: results,
        timestamp: new Date().toISOString(),
      });
      console.log(`[sentiment:lunar] published Galaxy Scores for ${results.length} assets`);
    }
  } catch (err) {
    console.error("[sentiment:lunar] fetch failed:", (err as Error).message);
  }
}

/**
 * Get aggregated sentiment for an asset (combines X + LunarCrush)
 */
export async function getAggregatedSentiment(asset: string): Promise<{
  xScore: number;
  lunarScore: number;
  combined: number;
  label: string;
  confidence: number;
} | null> {
  const since = new Date(Date.now() - 60 * 60 * 1000); // Last hour

  const [xSnapshots, lunarSnapshots] = await Promise.all([
    prisma.sentimentSnapshot.findMany({
      where: { source: "x", timestamp: { gte: since }, metadata: { path: ["asset"], equals: asset } },
      orderBy: { timestamp: "desc" },
      take: 10,
    }),
    prisma.sentimentSnapshot.findMany({
      where: { source: "lunarcrush", timestamp: { gte: since }, metadata: { path: ["asset"], equals: asset } },
      orderBy: { timestamp: "desc" },
      take: 5,
    }),
  ]);

  const xScore = xSnapshots.length > 0
    ? xSnapshots.reduce((sum, s) => sum + s.score, 0) / xSnapshots.length
    : 0;

  const lunarScore = lunarSnapshots.length > 0
    ? lunarSnapshots.reduce((sum, s) => sum + s.score, 0) / lunarSnapshots.length
    : 0;

  if (xSnapshots.length === 0 && lunarSnapshots.length === 0) return null;

  const combined = (xScore * 0.6 + lunarScore * 0.4); // Weight X higher for recency
  const label = combined > 0.15 ? "bullish" : combined < -0.15 ? "bearish" : "neutral";
  const confidence = Math.min(1, (xSnapshots.length * 0.1 + lunarSnapshots.length * 0.2));

  return { xScore, lunarScore, combined, label, confidence };
}

export async function healthCheck(_config: IntegrationConfig): Promise<{
  ok: boolean;
  xAvailable: boolean;
  lunarAvailable: boolean;
  error?: string;
}> {
  const xOk = !!process.env.X_API_BEARER_TOKEN;
  const lunarOk = !!process.env.LUNARCRUSH_API_KEY;
  return { ok: xOk || lunarOk, xAvailable: xOk, lunarAvailable: lunarOk };
}