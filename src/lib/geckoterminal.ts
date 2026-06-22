// ─────────────────────────────────────────────────────────────
// GeckoTerminal API Client (100% free, no auth needed)
// Docs: https://docs.geckoterminal.com/
// On-chain DEX data: trending pools, new pairs, OHLCV, 260+ networks
// ─────────────────────────────────────────────────────────────

const BASE = "https://api.geckoterminal.com/api/v2";

async function gtFetch<T>(path: string, cacheSec = 60): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    next: { revalidate: cacheSec },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GeckoTerminal ${path}: ${res.status}`);
  return (await res.json()) as T;
}

// ─── Trending & Discovery ──────────────────────────────────

export interface TrendingPool {
  id: string;
  type: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    base_token_price_native_currency: string;
    quote_token_price_native_currency: string;
    pool_created_at: string;
    fdv_usd: string;
    market_cap_usd: string | null;
    price_change_percentage: {
      m5: string;
      h1: string;
      h6: string;
      h24: string;
    };
    transactions: {
      m5: { buys: number; sells: number; buyers: number; sellers: number };
      h1: { buys: number; sells: number; buyers: number; sellers: number };
      h24: { buys: number; sells: number; buyers: number; sellers: number };
    };
    volume_usd: { m5: string; h1: string; h6: string; h24h: string };
    reserve_in_usd: string;
  };
  relationships: {
    base_token: { data: { id: string; type: string } };
    quote_token: { data: { id: string; type: string } };
    dex: { data: { id: string; type: string } };
  };
}

/** Get trending pools across all networks */
export async function getTrendingPools(network?: string, limit = 20): Promise<TrendingPool[]> {
  const path = network
    ? `/networks/${network}/trending_pools?page=1`
    : `/networks/trending_pools?page=1`;
  type Resp = { data: TrendingPool[] };
  const data = await gtFetch<Resp>(path, 60);
  return (data.data ?? []).slice(0, limit);
}

/** Get top pools for a specific network */
export async function getTopPools(network: string, limit = 20): Promise<TrendingPool[]> {
  type Resp = { data: TrendingPool[] };
  const data = await gtFetch<Resp>(`/networks/${network}/pools?page=1&sort=h24_tx_count_desc`, 120);
  return (data.data ?? []).slice(0, limit);
}

/** Get new pools (recently created) */
export async function getNewPools(network?: string, limit = 20): Promise<TrendingPool[]> {
  const path = network
    ? `/networks/${network}/new_pools?page=1`
    : `/networks/new_pools?page=1`;
  type Resp = { data: TrendingPool[] };
  const data = await gtFetch<Resp>(path, 30);
  return (data.data ?? []).slice(0, limit);
}

// ─── Pool Details ──────────────────────────────────────────

export interface PoolDetails {
  id: string;
  attributes: {
    name: string;
    address: string;
    pool_created_at: string;
    reserve_in_usd: string;
    fdv_usd: string;
    market_cap_usd: string | null;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    price_change_percentage: Record<string, string>;
    volume_usd: Record<string, string>;
    transactions: Record<string, { buys: number; sells: number }>;
  };
}

/** Get pool details by network and address */
export async function getPool(network: string, poolAddress: string): Promise<PoolDetails> {
  type Resp = { data: PoolDetails };
  const data = await gtFetch<Resp>(`/networks/${network}/pools/${poolAddress}`, 30);
  return data.data;
}

// ─── OHLCV Data ────────────────────────────────────────────

export interface OhlcvCandle {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/** Get OHLCV data for a pool */
export async function getPoolOhlcv(
  network: string,
  poolAddress: string,
  timeframe: "minute" | "hour" | "day" = "hour",
  limit = 48
): Promise<OhlcvCandle[]> {
  type Resp = { data: { attributes: { ohlcv_list: OhlcvCandle[] } } };
  const data = await gtFetch<Resp>(
    `/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=1&limit=${limit}&currency=usd`,
    timeframe === "minute" ? 30 : 300
  );
  return data.data?.attributes?.ohlcv_list ?? [];
}

// ─── Token Info ────────────────────────────────────────────

interface TokenInfo {
  id: string;
  attributes: {
    name: string;
    symbol: string;
    address: string;
    decimals: number;
    image_url: string;
    coingecko_coin_id: string | null;
    websites: string[];
    description: string;
    gt_score: number;
    holders: Record<string, unknown> | null;
  };
}

/** Get token info by network and address */
export async function getTokenInfo(network: string, tokenAddress: string): Promise<TokenInfo> {
  type Resp = { data: TokenInfo };
  const data = await gtFetch<Resp>(`/networks/${network}/tokens/${tokenAddress}`, 300);
  return data.data;
}

// ─── Search ────────────────────────────────────────────────

interface SearchResult {
  id: string;
  type: string;
  attributes: {
    name: string;
    address: string;
    symbol: string;
    pool_created_at: string;
  };
}

/** Search for pools or tokens */
export async function search(query: string): Promise<SearchResult[]> {
  type Resp = { data: SearchResult[] };
  const data = await gtFetch<Resp>(`/search?query=${encodeURIComponent(query)}&page=1`, 60);
  return data.data ?? [];
}

// ─── Utility ──────────────────────────────────────────────

/** Get trending pools formatted for NEXUS dashboard */
export async function getFormattedTrending(limit = 10): Promise<
  Array<{
    name: string;
    network: string;
    priceUsd: string;
    change24h: string;
    volume24h: string;
    txCount24h: number;
    liquidity: string;
    createdAt: string;
  }>
> {
  const pools = await getTrendingPools(undefined, limit);
  return pools.map((p) => ({
    name: p.attributes.name,
    network: p.id.split("_")[0] || "unknown",
    priceUsd: p.attributes.base_token_price_usd,
    change24h: p.attributes.price_change_percentage.h24,
    volume24h: p.attributes.volume_usd.h24h,
    txCount24h: p.attributes.transactions.h24.buys + p.attributes.transactions.h24.sells,
    liquidity: p.attributes.reserve_in_usd,
    createdAt: p.attributes.pool_created_at,
  }));
}

/** Health check */
export async function healthCheck(): Promise<{ ok: boolean; trendingCount?: number; error?: string }> {
  try {
    const pools = await getTrendingPools(undefined, 5);
    return { ok: true, trendingCount: pools.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
