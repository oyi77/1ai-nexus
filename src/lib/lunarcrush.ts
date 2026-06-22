// ─────────────────────────────────────────────────────────────
// LunarCrush API Client (free tier available)
// Docs: https://lunarcrush.com/developers/docs
// Social sentiment, trending coins, galaxy score, alt rank
// ─────────────────────────────────────────────────────────────

const BASE = "https://lunarcrush.com/api4";

function getApiKey(): string | undefined {
  return process.env.LUNARCRUSH_API_KEY || undefined;
}

async function lcFetch<T>(path: string, cacheSec = 120): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("LUNARCRUSH_API_KEY not set");

  const res = await fetch(`${BASE}${path}`, {
    next: { revalidate: cacheSec },
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) throw new Error(`LunarCrush ${path}: ${res.status}`);
  return (await res.json()) as T;
}

// ─── Coins Overview ────────────────────────────────────────

interface CoinMetrics {
  id: number;
  name: string;
  symbol: string;
  price: number;
  price_btc: number;
  market_cap: number;
  volume_24h: number;
  percent_change_24h: number;
  percent_change_7d: number;
  galaxy_score: number;
  alt_rank: number;
  volatility: number;
  social_volume_24h: number;
  social_dominance: number;
  sentiment: number;
  contributors_active: number;
  posts_active: number;
  interactions_24h: number;
}

/** Get top coins by Galaxy Score */
export async function getTopByGalaxyScore(limit = 20): Promise<CoinMetrics[]> {
  type Resp = { data: CoinMetrics[] };
  const data = await lcFetch<Resp>(`/public/coins/top/galaxy-score?limit=${limit}`, 300);
  return data.data ?? [];
}

/** Get top coins by Alt Rank */
export async function getTopByAltRank(limit = 20): Promise<CoinMetrics[]> {
  type Resp = { data: CoinMetrics[] };
  const data = await lcFetch<Resp>(`/public/coins/top/alt-rank?limit=${limit}`, 300);
  return data.data ?? [];
}

/** Get trending coins by social volume */
export async function getTrendingCoins(limit = 20): Promise<CoinMetrics[]> {
  type Resp = { data: CoinMetrics[] };
  const data = await lcFetch<Resp>(`/public/coins/trending?limit=${limit}`, 120);
  return data.data ?? [];
}

/** Get specific coin metrics */
export async function getCoinMetrics(symbol: string): Promise<CoinMetrics> {
  type Resp = { data: CoinMetrics };
  const data = await lcFetch<Resp>(`/public/coins/${symbol}/v1`, 120);
  return data.data;
}

// ─── Social Posts ──────────────────────────────────────────

interface SocialPost {
  id: string;
  post_type: string;
  created_at: number;
  title: string;
  body: string;
  url: string;
  source: string;
  sentiment: number;
  interactions_24h: number;
  creators: number;
}

/** Get top social posts for a coin */
export async function getTopPosts(symbol: string, limit = 10): Promise<SocialPost[]> {
  type Resp = { data: SocialPost[] };
  const data = await lcFetch<Resp>(`/public/coins/${symbol}/posts?limit=${limit}`, 300);
  return data.data ?? [];
}

// ─── Utility ──────────────────────────────────────────────

/** Health check */
export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: "LUNARCRUSH_API_KEY not set" };
  try {
    const coins = await getTopByGalaxyScore(1);
    return { ok: coins.length > 0 };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
