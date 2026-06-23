// ─────────────────────────────────────────────────────────────
// Social Sentiment & Trending — Free alternatives (no API key)
// Replaces LunarCrush with CoinGecko + Reddit public endpoints
// CoinGecko: https://api.coingecko.com/api/v3/
// Reddit:    https://www.reddit.com/r/cryptocurrency/hot.json
// ─────────────────────────────────────────────────────────────

const COINGECKO = "https://api.coingecko.com/api/v3";
const TIMEOUT = 5_000; // 5s max

// ─── In-memory cache (avoids hitting rate limits) ──────────

const cache = new Map<string, { data: unknown; expires: number }>();

async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.data as T;

  const data = await fetcher();
  cache.set(key, { data, expires: now + ttlMs });
  return data;
}

// ─── CoinGecko fetcher ─────────────────────────────────────

interface CGCoinMarket {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
  current_price: number;
  price_btc?: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  high_24h: number;
  low_24h: number;
  circulating_supply: number;
}

interface CGCoinDetail {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
  market_data: {
    current_price: { usd: number; btc: number };
    market_cap: { usd: number };
    total_volume: { usd: number };
    price_change_percentage_24h: number | null;
    price_change_percentage_7d: number | null;
    high_24h: { usd: number };
    low_24h: { usd: number };
    circulating_supply: number;
  };
  community_data?: {
    reddit_subscribers?: number | null;
    reddit_average_posts_48h?: number | null;
    reddit_average_comments_48h?: number | null;
    reddit_accounts_active_48h?: number | null;
    telegram_channel_user_count?: number | null;
    twitter_followers?: number | null;
  };
  description?: { en?: string };
  links?: {
    homepage?: string[];
    blockchain_site?: string[];
    subreddit_url?: string;
    twitter_screen_name?: string;
    telegram_channel_identifier?: string;
  };
}

interface CGTrendingItem {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
  score: number;
  data?: {
    price?: number;
    price_btc?: string;
    total_volume?: string;
    market_cap?: string;
    price_change_percentage_24h?: { usd?: number };
  };
}

async function cgFetch<T>(path: string): Promise<T> {
  // Retry with backoff on 429 (rate limit)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${COINGECKO}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 429) {
      const waitMs = Math.min(2000 * (attempt + 1), 5000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) throw new Error(`CoinGecko ${path}: ${res.status}`);
    return (await res.json()) as T;
  }
  throw new Error(`CoinGecko ${path}: rate limited after retries`);
}

// ─── Reddit fetcher (public JSON, no auth) ─────────────────

interface RedditPost {
  data: {
    id: string;
    title: string;
    selftext: string;
    url: string;
    permalink: string;
    created_utc: number;
    score: number;
    num_comments: number;
    author: string;
    subreddit: string;
  };
}

interface RedditListing {
  data: { children: RedditPost[] };
}

async function redditFetch(
  subreddit: string,
  limit: number,
): Promise<RedditPost[]> {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}&raw_json=1`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "1ai-tracker:v1.0.0 (crypto sentiment aggregator)",
        },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as RedditListing;
    return data?.data?.children ?? [];
  } catch {
    return [];
  }
}

// ─── Exported Interfaces ───────────────────────────────────

export interface CoinMetrics {
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

export interface SocialPost {
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

// ─── Mappers ───────────────────────────────────────────────

/**
 * Compute a galaxy-score proxy from market metrics.
 * Range 0–100: combines 24h/7d price change (momentum),
 * volume/market-cap ratio (liquidity), and volatility penalty.
 */
function computeGalaxyScore(cg: CGCoinMarket): number {
  const ch24 = cg.price_change_percentage_24h ?? 0;
  const ch7d = cg.price_change_percentage_7d_in_currency ?? 0;
  const volRatio = cg.market_cap > 0 ? cg.total_volume / cg.market_cap : 0;
  const range = cg.current_price > 0 && cg.high_24h > 0
    ? (cg.high_24h - cg.low_24h) / cg.current_price
    : 0;

  // Momentum: positive changes boost score
  const momentum = Math.max(0, Math.min(50, 25 + ch24 * 0.5 + ch7d * 0.2));
  // Liquidity: higher volume/mcap is better (cap at 0.5 = 25 pts)
  const liquidity = Math.min(25, volRatio * 50);
  // Stability: lower volatility range is better (cap at 25)
  const stability = Math.max(0, 25 - range * 100);

  return Math.round(Math.max(0, Math.min(100, momentum + liquidity + stability)));
}

/**
 * Alt-rank proxy: lower market cap + higher social activity = better alt rank.
 * We assign rank 1..N by sorting on (negative market_cap_rank + volume spike).
 */
function computeAltRank(index: number, total: number): number {
  return Math.round((index / Math.max(1, total)) * 100);
}

function toCoinMetrics(cg: CGCoinMarket, index: number, total: number): CoinMetrics {
  const range = cg.current_price > 0 && cg.high_24h > 0
    ? (cg.high_24h - cg.low_24h) / cg.current_price
    : 0;
  return {
    id: cg.market_cap_rank ?? index,
    name: cg.name,
    symbol: cg.symbol.toUpperCase(),
    price: cg.current_price,
    price_btc: cg.price_btc ?? 0,
    market_cap: cg.market_cap,
    volume_24h: cg.total_volume,
    percent_change_24h: cg.price_change_percentage_24h ?? 0,
    percent_change_7d: cg.price_change_percentage_7d_in_currency ?? 0,
    galaxy_score: computeGalaxyScore(cg),
    alt_rank: computeAltRank(index, total),
    volatility: Math.round(range * 10000) / 100,
    social_volume_24h: 0, // populated by enrichment
    social_dominance: 0,
    sentiment: 50 + (cg.price_change_percentage_24h ?? 0) * 0.5, // proxy: 50 = neutral
    contributors_active: 0,
    posts_active: 0,
    interactions_24h: 0,
  };
}

// ─── Cache keys ────────────────────────────────────────────

const CACHE_TTL = {
  MARKETS: 120_000,    // 2 min
  TRENDING: 120_000,   // 2 min
  COIN: 300_000,       // 5 min
  SOCIAL: 300_000,     // 5 min
} as const;

// ─── Exported Functions ────────────────────────────────────

/** Get top coins by Galaxy Score (composite market health metric) */
export async function getTopByGalaxyScore(limit = 20): Promise<CoinMetrics[]> {
  const coins = await cachedFetch<CGCoinMarket[]>(
    `markets:top:${limit}`,
    CACHE_TTL.MARKETS,
    () =>
      cgFetch<CGCoinMarket[]>(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h,7d`,
      ),
  );

  const mapped = coins.map((c, i) => toCoinMetrics(c, i, coins.length));
  // Sort by galaxy_score descending
  mapped.sort((a, b) => b.galaxy_score - a.galaxy_score);
  return mapped;
}

/** Get top coins by Alt Rank (proxy: volume/market-cap ratio + positive momentum) */
export async function getTopByAltRank(limit = 20): Promise<CoinMetrics[]> {
  const coins = await cachedFetch<CGCoinMarket[]>(
    `markets:top:${limit}`,
    CACHE_TTL.MARKETS,
    () =>
      cgFetch<CGCoinMarket[]>(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h,7d`,
      ),
  );

  const mapped = coins.map((c, i) => toCoinMetrics(c, i, coins.length));
  // Alt-rank: higher volume/mcap ratio = better alt rank
  mapped.sort((a, b) => {
    const ratioA = a.market_cap > 0 ? a.volume_24h / a.market_cap : 0;
    const ratioB = b.market_cap > 0 ? b.volume_24h / b.market_cap : 0;
    return ratioB - ratioA;
  });
  // Reassign rank positions
  mapped.forEach((m, i) => { m.alt_rank = i + 1; });
  return mapped;
}

/** Get trending coins by social volume (CoinGecko trending) */
export async function getTrendingCoins(limit = 20): Promise<CoinMetrics[]> {
  const trending = await cachedFetch<{ coins: { item: CGTrendingItem }[] }>(
    "trending",
    CACHE_TTL.TRENDING,
    () => cgFetch<{ coins: { item: CGTrendingItem }[] }>("/search/trending"),
  );

  const items = trending.coins.slice(0, limit);
  return items.map((entry, i) => {
    const item = entry.item;
    const data = item.data;
    const price = data?.price ?? 0;
    const volumeStr = data?.total_volume?.replace(/[^0-9.]/g, "") ?? "0";
    const mcapStr = data?.market_cap?.replace(/[^0-9.]/g, "") ?? "0";
    const volume = parseFloat(volumeStr) || 0;
    const marketCap = parseFloat(mcapStr) || 0;
    const ch24 = data?.price_change_percentage_24h?.usd ?? 0;

    return {
      id: item.market_cap_rank ?? i,
      name: item.name,
      symbol: item.symbol.toUpperCase(),
      price,
      price_btc: 0,
      market_cap: marketCap,
      volume_24h: volume,
      percent_change_24h: ch24,
      percent_change_7d: 0,
      galaxy_score: Math.round(50 + ch24 * 0.5),
      alt_rank: i + 1,
      volatility: 0,
      social_volume_24h: (item.score + 1) * 100, // score is 0-based rank
      social_dominance: Math.round(((limit - i) / limit) * 100),
      sentiment: 50 + ch24 * 0.5,
      contributors_active: 0,
      posts_active: 0,
      interactions_24h: (item.score + 1) * 500,
    } satisfies CoinMetrics;
  });
}

/** Get specific coin metrics from CoinGecko */
export async function getCoinMetrics(symbol: string): Promise<CoinMetrics> {
  const cgId = symbol.toLowerCase();

  const coin = await cachedFetch<CGCoinDetail>(
    `coin:${cgId}`,
    CACHE_TTL.COIN,
    () =>
      cgFetch<CGCoinDetail>(
        `/coins/${cgId}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`,
      ),
  );

  const md = coin.market_data;
  const cd = coin.community_data ?? {};
  const high = md.high_24h?.usd ?? 0;
  const low = md.low_24h?.usd ?? 0;
  const price = md.current_price?.usd ?? 0;
  const range = price > 0 && high > 0 ? (high - low) / price : 0;

  const ch24 = md.price_change_percentage_24h ?? 0;
  const ch7d = md.price_change_percentage_7d ?? 0;
  const volRatio = (md.market_cap?.usd ?? 0) > 0
    ? (md.total_volume?.usd ?? 0) / (md.market_cap?.usd ?? 1)
    : 0;

  const galaxyScore = Math.round(
    Math.max(0, Math.min(100,
      Math.max(0, Math.min(50, 25 + ch24 * 0.5 + ch7d * 0.2))
      + Math.min(25, volRatio * 50)
      + Math.max(0, 25 - range * 100)
    ))
  );

  const socialVolume = (cd.reddit_average_posts_48h ?? 0) * 12
    + (cd.reddit_average_comments_48h ?? 0)
    + (cd.telegram_channel_user_count ?? 0) * 0.001;

  return {
    id: coin.market_cap_rank ?? 0,
    name: coin.name,
    symbol: coin.symbol.toUpperCase(),
    price,
    price_btc: md.current_price?.btc ?? 0,
    market_cap: md.market_cap?.usd ?? 0,
    volume_24h: md.total_volume?.usd ?? 0,
    percent_change_24h: ch24,
    percent_change_7d: ch7d,
    galaxy_score: galaxyScore,
    alt_rank: coin.market_cap_rank ?? 999,
    volatility: Math.round(range * 10000) / 100,
    social_volume_24h: Math.round(socialVolume),
    social_dominance: 0,
    sentiment: Math.round(Math.max(0, Math.min(100, 50 + ch24 * 0.5))),
    contributors_active: (cd.reddit_accounts_active_48h ?? 0)
      + (cd.telegram_channel_user_count ?? 0) * 0.01,
    posts_active: cd.reddit_average_posts_48h ?? 0,
    interactions_24h: Math.round(
      (cd.reddit_average_comments_48h ?? 0) * 12
      + (cd.reddit_subscribers ?? 0) * 0.001
    ),
  };
}

/** Get top social posts for a coin (Reddit + CoinGecko community data) */
export async function getTopPosts(
  symbol: string,
  limit = 10,
): Promise<SocialPost[]> {
  const key = `posts:${symbol}:${limit}`;
  return cachedFetch<SocialPost[]>(key, CACHE_TTL.SOCIAL, async () => {
    const cgId = symbol.toLowerCase();

    // Try Reddit first (works in environments that aren't rate-limited)
    const subreddit = symbolToSubreddit(cgId);
    const redditPosts = subreddit ? await redditFetch(subreddit, limit) : [];

    if (redditPosts.length > 0) {
      return redditPosts.slice(0, limit).map((p) => ({
        id: `reddit-${p.data.id}`,
        post_type: "social",
        created_at: Math.round(p.data.created_utc * 1000),
        title: p.data.title,
        body: p.data.selftext?.slice(0, 500) ?? "",
        url: `https://www.reddit.com${p.data.permalink}`,
        source: "reddit",
        sentiment: scoreToSentiment(p.data.score),
        interactions_24h: p.data.score + p.data.num_comments,
        creators: 1,
      }));
    }

    // Fallback: build synthetic social data from CoinGecko community metrics
    try {
      const coin = await cgFetch<CGCoinDetail>(
        `/coins/${cgId}?localization=false&tickers=false&market_data=false&community_data=true&developer_data=false&sparkline=false`,
      );
      const cd = coin.community_data ?? {};
      const posts: SocialPost[] = [];

      if ((cd.reddit_subscribers ?? 0) > 0) {
        posts.push({
          id: `cg-reddit-${cgId}`,
          post_type: "social",
          created_at: Date.now(),
          title: `${coin.name} Reddit Community (${cd.reddit_subscribers?.toLocaleString()} subscribers)`,
          body: `Active accounts (48h): ${cd.reddit_accounts_active_48h ?? 0}. Avg posts (48h): ${cd.reddit_average_posts_48h ?? 0}. Avg comments (48h): ${cd.reddit_average_comments_48h ?? 0}.`,
          url: coin.links?.subreddit_url ?? `https://www.reddit.com/r/${subreddit ?? cgId}`,
          source: "reddit",
          sentiment: 50,
          interactions_24h: (cd.reddit_average_posts_48h ?? 0) * 12
            + (cd.reddit_average_comments_48h ?? 0),
          creators: cd.reddit_accounts_active_48h ?? 0,
        });
      }

      if ((cd.telegram_channel_user_count ?? 0) > 0) {
        posts.push({
          id: `cg-telegram-${cgId}`,
          post_type: "social",
          created_at: Date.now(),
          title: `${coin.name} Telegram Community (${cd.telegram_channel_user_count?.toLocaleString()} members)`,
          body: `Active Telegram channel with ${cd.telegram_channel_user_count?.toLocaleString()} members.`,
          url: coin.links?.telegram_channel_identifier
            ? `https://t.me/${coin.links.telegram_channel_identifier}`
            : "",
          source: "telegram",
          sentiment: 50,
          interactions_24h: (cd.telegram_channel_user_count ?? 0) * 0.01,
          creators: cd.telegram_channel_user_count ?? 0,
        });
      }

      if (posts.length === 0) {
        posts.push({
          id: `cg-none-${cgId}`,
          post_type: "social",
          created_at: Date.now(),
          title: `No social data available for ${coin.name}`,
          body: "Community data is not available from CoinGecko for this asset.",
          url: "",
          source: "coingecko",
          sentiment: 50,
          interactions_24h: 0,
          creators: 0,
        });
      }

      return posts.slice(0, limit);
    } catch {
      return [{
        id: `error-${cgId}`,
        post_type: "social",
        created_at: Date.now(),
        title: `Unable to fetch social data for ${symbol}`,
        body: "Both Reddit and CoinGecko community endpoints are unavailable.",
        url: "",
        source: "error",
        sentiment: 50,
        interactions_24h: 0,
        creators: 0,
      }];
    }
  });
}

// ─── Utility ───────────────────────────────────────────────

/** Health check — uses CoinGecko ping (no API key needed) */
export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${COINGECKO}/ping`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return { ok: false, error: `CoinGecko ping: ${res.status}` };
    const data = (await res.json()) as { gecko_says?: string };
    return { ok: !!data.gecko_says };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Helpers ───────────────────────────────────────────────

/** Map common coin ids to their primary subreddit */
function symbolToSubreddit(id: string): string | null {
  const map: Record<string, string> = {
    bitcoin: "Bitcoin",
    ethereum: "ethereum",
    solana: "solana",
    dogecoin: "dogecoin",
    cardano: "cardano",
    ripple: "ripple",
    polkadot: "dot",
    avalanche: "avaxchain",
    chainlink: "chainlink",
    polygon: "0xpolygon",
    cosmos: "cosmosnetwork",
    litecoin: "litecoin",
    monero: "monero",
    stellar: "stellar",
    tron: "tronix",
    tether: "tether",
    "usd-coin": "USDC",
    "binancecoin": "bnbchainofficial",
    "shiba-inu": "SHIBArmy",
    "pepe": "pepecoin",
    "sui": "SuiNetwork",
    "aptos": "aptos",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
  };
  // Direct match
  if (map[id]) return map[id];
  // Fallback: use coin id as subreddit (many coins have matching subreddits)
  return id;
}

/** Convert Reddit score to a 0–100 sentiment value */
function scoreToSentiment(score: number): number {
  if (score <= 0) return 30;
  if (score < 10) return 45;
  if (score < 50) return 55;
  if (score < 200) return 65;
  if (score < 1000) return 75;
  return 85;
}
