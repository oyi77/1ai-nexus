// ─────────────────────────────────────────────────────────────
// CryptoCompare API Client (free tier, optional API key)
// Docs: https://min-api.cryptocompare.com/documentation
// OHLCV, social stats, news feeds, exchange data
// ─────────────────────────────────────────────────────────────

const BASE = "https://min-api.cryptocompare.com";

function getApiKey(): string | undefined {
  return process.env.CRYPTOCOMPARE_API_KEY || undefined;
}

async function ccFetch<T>(path: string, cacheSec = 60): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE}${path}`);
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const res = await fetch(url.toString(), {
    next: { revalidate: cacheSec },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`CryptoCompare ${path}: ${res.status}`);
  return (await res.json()) as T;
}

// ─── Price Data ────────────────────────────────────────────

interface PriceData {
  [symbol: string]: {
    USD: number;
    EUR?: number;
    BTC?: number;
    ETH?: number;
  };
}

/** Get current prices for multiple symbols */
export async function getPrices(syms: string[], tsyms = "USD"): Promise<PriceData> {
  return ccFetch(`/data/pricemulti?fsyms=${syms.join(",")}&tsyms=${tsyms}`, 30);
}

/** Get single price */
export async function getPrice(fsym: string, tsym = "USD"): Promise<number> {
  type Resp = { [key: string]: number };
  const data = await ccFetch<Resp>(`/data/price?fsym=${fsym}&tsyms=${tsym}`, 30);
  return data[tsym];
}

// ─── OHLCV ────────────────────────────────────────────────

interface OhlcvData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumefrom: number;
  volumeto: number;
}

/** Get hourly OHLCV data */
export async function getHourlyOhlcv(fsym: string, tsym = "USD", limit = 168): Promise<OhlcvData[]> {
  type Resp = { Data: OhlcvData[] };
  const data = await ccFetch<Resp>(`/data/v2/histohour?fsym=${fsym}&tsym=${tsym}&limit=${limit}`, 300);
  return data.Data ?? [];
}

/** Get daily OHLCV data */
export async function getDailyOhlcv(fsym: string, tsym = "USD", limit = 30): Promise<OhlcvData[]> {
  type Resp = { Data: OhlcvData[] };
  const data = await ccFetch<Resp>(`/data/v2/histoday?fsym=${fsym}&tsym=${tsym}&limit=${limit}`, 600);
  return data.Data ?? [];
}

// ─── News ──────────────────────────────────────────────────

interface NewsArticle {
  id: string;
  published_on: number;
  title: string;
  url: string;
  body: string;
  tags: string;
  categories: string;
  source: string;
  source_info: { name: string; lang: string; img: string };
  lang: string;
  upvotes: number;
  downvotes: number;
}

/** Get latest crypto news */
export async function getNews(categories?: string, limit = 20): Promise<NewsArticle[]> {
  const params = new URLSearchParams({ lang: "EN", sortOrder: "latest" });
  if (categories) params.set("categories", categories);
  type Resp = { Data: NewsArticle[] };
  const data = await ccFetch<Resp>(`/data/v2/news/?${params}`, 120);
  return (data.Data ?? []).slice(0, limit);
}

// ─── Social Stats ──────────────────────────────────────────

interface SocialStats {
  Reddit: { active_users: number; subscribers: number; posts_per_day: number };
  Twitter: { followers: number; statuses: number };
  CryptoCompare: { points: number; followers: number };
}

/** Get social stats for a coin */
export async function getSocialStats(coinId: string): Promise<SocialStats> {
  return ccFetch(`/data/social/coin/latest?coinId=${coinId}`, 600);
}

// ─── Top Lists ─────────────────────────────────────────────

export interface TopPair {
  exchange: string;
  fromSymbol: string;
  toSymbol: string;
  volume24h: number;
  volume24hTo: number;
}

/** Get top trading pairs by volume */
export async function getTopPairs(fsym: string, tsym = "USD", limit = 10): Promise<TopPair[]> {
  type Resp = { Data: TopPair[] };
  const data = await ccFetch<Resp>(`/data/top/pairs?fsym=${fsym}&tsym=${tsym}&limit=${limit}`, 300);
  return data.Data ?? [];
}

// ─── Utility ──────────────────────────────────────────────

/** Health check */
export async function healthCheck(): Promise<{ ok: boolean; btcPrice?: number; error?: string }> {
  try {
    const btcPrice = await getPrice("BTC");
    return { ok: true, btcPrice };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
