import { type NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import * as coinpaprika from "@/lib/coinpaprika";

export const dynamic = "force-dynamic";

// ─── Types ─────────────────────────────────────────────────

interface FnGResponse {
  name: string;
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
    time_until_update: string;
  }>;
}

interface CoinGeckoGlobal {
  data: {
    market_cap_change_percentage_24h_usd: number;
    active_cryptocurrencies: number;
    markets: number;
    total_market_cap: { btc: number; usd: number };
    total_volume: { btc: number; usd: number };
    market_cap_percentage: { btc: number; eth: number };
  };
}

interface CategoryScore {
  score: number;
  weight: number;
  source: string;
}

interface FearGreedData {
  composite: { score: number; label: string; previousScore: number; change: number };
  categories: {
    sentiment: CategoryScore;
    volatility: CategoryScore;
    momentum: CategoryScore;
    dominance: CategoryScore;
    volume: CategoryScore;
    social: CategoryScore;
  };
  regime: { state: string; stance: string };
  headerMetrics: { btcDom: number; totalMcap: number; mcapChange24h: number };
  history: Array<{ date: string; score: number }>;
}

// ─── Scoring helpers ───────────────────────────────────────

function mapVolatility(absChange: number): number {
  if (absChange < 3) return 70;
  if (absChange < 5) return 50;
  if (absChange < 10) return 30;
  return 15;
}

function mapMomentum(absChange: number): number {
  if (absChange < 3) return 70;
  if (absChange < 5) return 50;
  if (absChange < 10) return 30;
  return 15;
}

function mapDominance(btcDom: number): number {
  if (btcDom > 60) return 30;
  if (btcDom >= 45) return 50;
  return 70;
}

function mapVolume(volumeChange: number): number {
  // Positive volume change = greed, negative = fear
  if (volumeChange > 30) return 80;
  if (volumeChange > 10) return 65;
  if (volumeChange > -10) return 50;
  if (volumeChange > -30) return 35;
  return 20;
}

function scoreToLabel(score: number): string {
  if (score <= 20) return "Extreme Fear";
  if (score <= 35) return "Fear";
  if (score <= 50) return "Neutral";
  if (score <= 65) return "Greed";
  return "Extreme Greed";
}

function scoreToRegime(score: number): { state: string; stance: string } {
  if (score <= 20) return { state: "Crisis", stance: "CASH" };
  if (score <= 35) return { state: "Stressed", stance: "DEFENSIVE" };
  if (score <= 50) return { state: "Fragile", stance: "HEDGED" };
  if (score <= 65) return { state: "Stable", stance: "NORMAL" };
  return { state: "Strong", stance: "AGGRESSIVE" };
}

// ─── Cache ─────────────────────────────────────────────────

// ─── Handler ───────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    const { getCached } = await import('@/lib/api/server-cache')
    
    const { data: result, fromCache } = await getCached('fear-greed', 60_000, async () => {

    // Fetch all sources in parallel
    const [fngRes, geckoRes, globalData, btcTicker] = await Promise.all([
      fetch("https://api.alternative.me/fng/?limit=7", { next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) })
        .then((r) => r.json() as Promise<FnGResponse>),
      fetch("https://api.coingecko.com/api/v3/global", { next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) })
        .then((r) => r.json() as Promise<CoinGeckoGlobal>),
      coinpaprika.getGlobal(),
      coinpaprika.getTicker("btc-bitcoin"),
    ]);

    const fngData = fngRes.data;
    if (!fngData || fngData.length === 0) {
      return apiError("Empty response from Alternative.me", 502);
    }

    const currentFnG = Number(fngData[0].value);
    const previousFnG = fngData.length > 1 ? Number(fngData[1].value) : currentFnG;

    // BTC metrics from CoinGecko
    const btcDom = geckoRes.data.market_cap_percentage.btc;
    const mcapChange24h = geckoRes.data.market_cap_change_percentage_24h_usd;

    // BTC price changes from CoinPaprika
    const btcChange24h = Math.abs(btcTicker.change24h);
    const btcChange7d = Math.abs(btcTicker.change7d);

    // Volume change from CoinPaprika
    const volumeChange = globalData.volume_24h_change_24h;

    // Compute category scores
    const sentimentScore = currentFnG;
    const volatilityScore = mapVolatility(btcChange24h);
    const momentumScore = mapMomentum(btcChange7d);
    const dominanceScore = mapDominance(btcDom);
    const volumeScore = mapVolume(volumeChange);
    // Social activity proxy: derived from volume change (higher volume = higher social interest)
    const socialScore = mapVolume(volumeChange);

    // Weighted composite
    const weights = {
      sentiment: 0.25,
      volatility: 0.2,
      momentum: 0.2,
      dominance: 0.15,
      volume: 0.1,
      social: 0.1,
    };

    const compositeScore = Math.round(
      sentimentScore * weights.sentiment +
      volatilityScore * weights.volatility +
      momentumScore * weights.momentum +
      dominanceScore * weights.dominance +
      volumeScore * weights.volume +
      socialScore * weights.social
    );

    const clampedScore = Math.max(0, Math.min(100, compositeScore));

    // History from Alternative.me
    const history = fngData.map((d) => ({
      date: new Date(Number(d.timestamp) * 1000).toISOString().split("T")[0],
      score: Number(d.value),
    }));

    const result: FearGreedData = {
      composite: {
        score: clampedScore,
        label: scoreToLabel(clampedScore),
        previousScore: previousFnG,
        change: clampedScore - previousFnG,
      },
      categories: {
        sentiment: { score: sentimentScore, weight: weights.sentiment, source: "Alternative.me" },
        volatility: { score: volatilityScore, weight: weights.volatility, source: "CoinPaprika BTC 24h" },
        momentum: { score: momentumScore, weight: weights.momentum, source: "CoinPaprika BTC 7d" },
        dominance: { score: dominanceScore, weight: weights.dominance, source: "CoinGecko BTC Dom" },
        volume: { score: volumeScore, weight: weights.volume, source: "CoinPaprika Volume" },
        social: { score: socialScore, weight: weights.social, source: "Sentiment Proxy" },
      },
      regime: scoreToRegime(clampedScore),
      headerMetrics: {
        btcDom,
        totalMcap: globalData.market_cap_usd,
        mcapChange24h,
      },
      history,
    };

    return result
    })

    const r = apiSuccess(result);
    r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    r.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return r
  } catch (error) {
    console.error("GET /api/v1/fear-greed error:", error);
    return apiError("Failed to compute Fear & Greed index", 502);
  }
}
