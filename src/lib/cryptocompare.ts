// ─────────────────────────────────────────────────────────────
// Crypto Market Data Client (CoinGecko free API, no API key)
// Docs: https://www.coingecko.com/en/api/documentation
// Replaces CryptoCompare — same exported interface
// ─────────────────────────────────────────────────────────────

const BASE = "https://api.coingecko.com/api/v3";
const TIMEOUT = 5_000;

// ─── In-memory cache ──────────────────────────────────────

const cache = new Map<string, { data: unknown; expires: number }>();

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data as T;
  cache.delete(key);
  return undefined;
}

function setCache(key: string, data: unknown, ttlSec: number): void {
  cache.set(key, { data, expires: Date.now() + ttlSec * 1_000 });
}

// ─── Fetch helper ─────────────────────────────────────────

async function cgFetch<T>(path: string, cacheSec = 60): Promise<T> {
  const cacheKey = `cg:${path}`;
  const cached = getCached<T>(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${BASE}${path}`;
  const headers = { Accept: "application/json" };

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(attempt * 5_000, 30_000);
      await new Promise<void>((r) => setTimeout(r, backoff));
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status === 429) { lastErr = "429 rate limited"; continue; }
    if (!res.ok) throw new Error(`CoinGecko ${path}: ${res.status}`);
    const data = (await res.json()) as T;
    setCache(cacheKey, data, cacheSec);
    return data;
  }
  throw new Error(`CoinGecko ${path}: ${lastErr} (exhausted retries)`);
}

// ─── Symbol → CoinGecko ID mapping ─────────────────────────

// Fallback map for the most common tickers (avoids a round-trip for hot paths)
const KNOWN_IDS: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  bnb: "binancecoin",
  sol: "solana",
  xrp: "ripple",
  doge: "dogecoin",
  ada: "cardano",
  avax: "avalanche-2",
  dot: "polkadot",
  link: "chainlink",
  matic: "matic-network",
  polygon: "matic-network",
  uni: "uniswap",
  atom: "cosmos",
  ltc: "litecoin",
  etc: "ethereum-classic",
  algo: "algorand",
  near: "near",
  ftm: "fantom",
  aave: "aave",
  usdt: "tether",
  usdc: "usd-coin",
  busd: "binance-usd",
  dai: "dai",
  shib: "shiba-inu",
  trx: "tron",
  wbtc: "wrapped-bitcoin",
  steth: "staked-ether",
  cronos: "crypto-com-chain",
  cro: "crypto-com-chain",
  xlm: "stellar",
  hbar: "hedera-hashgraph",
  vet: "vechain",
  icp: "internet-computer",
  fil: "filecoin",
  egld: "elrond-erd-2",
  theta: "theta-token",
  xmr: "monero",
  eos: "eos",
  aax: "aax-token",
  mkr: "maker",
  grt: "the-graph",
  enj: "enjincoin",
  sand: "the-sandbox",
  mana: "decentraland",
  axs: "axie-infinity",
  gala: "gala",
  ape: "apecoin",
  ldo: "lido-dao",
  op: "optimism",
  arb: "arbitrum",
  pepe: "pepe",
  bonk: "bonk",
  sui: "sui",
  sei: "sei-network",
  apt: "aptos",
  inj: "injective-protocol",
  tia: "celestia",
  rune: "thorchain",
  render: "render-token",
  rndr: "render-token",
  wld: "worldcoin-wld",
  floki: "floki",
};

let symbolMapPromise: Promise<Map<string, string>> | null = null;

async function loadSymbolMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // Seed with known IDs
  for (const [sym, id] of Object.entries(KNOWN_IDS)) {
    map.set(sym, id);
  }
  try {
    type CoinEntry = { id: string; symbol: string; name: string };
    const coins = await cgFetch<CoinEntry[]>("/coins/list", 1800);
    for (const c of coins) {
      const sym = c.symbol.toLowerCase();
      if (!map.has(sym)) map.set(sym, c.id);
    }
  } catch {
    // If the full list fails we still have KNOWN_IDS
  }
  return map;
}

async function resolveId(symbol: string): Promise<string> {
  if (!symbolMapPromise) symbolMapPromise = loadSymbolMap();
  const map = await symbolMapPromise;
  const id = map.get(symbol.toLowerCase());
  if (!id) throw new Error(`Unknown coin symbol: ${symbol}`);
  return id;
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
  const ids = await Promise.all(syms.map((s) => resolveId(s)));
  const vs = tsyms.toLowerCase();
  type Resp = Record<string, Record<string, number>>;
  const data = await cgFetch<Resp>(
    `/simple/price?ids=${ids.join(",")}&vs_currencies=${vs}`,
    30,
  );
  const result: PriceData = {};
  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i].toUpperCase();
    const id = ids[i];
    const entry = data[id];
    if (entry) {
      result[sym] = { USD: entry[vs] ?? 0 };
    }
  }
  return result;
}

/** Get single price */
export async function getPrice(fsym: string, tsym = "USD"): Promise<number> {
  const id = await resolveId(fsym);
  const vs = tsym.toLowerCase();
  type Resp = Record<string, Record<string, number>>;
  const data = await cgFetch<Resp>(
    `/simple/price?ids=${id}&vs_currencies=${vs}`,
    30,
  );
  return data[id]?.[vs] ?? 0;
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

// CoinGecko /coins/{id}/ohlc only supports 1/7/14/30/90/180/365/max days
// and returns fewer candles for longer ranges. We pick the smallest valid
// `days` value that yields at least `limit` candles.

/** Get hourly OHLCV data */
export async function getHourlyOhlcv(fsym: string, _tsym = "USD", limit = 168): Promise<OhlcvData[]> {
  const id = await resolveId(fsym);
  // CoinGecko returns ~168 candles for 7 days at hourly resolution
  const days = Math.max(1, Math.ceil(limit / 24));
  // /coins/{id}/ohlc returns [[timestamp, open, high, low, close], ...]
  type Resp = [number, number, number, number, number][];
  const raw = await cgFetch<Resp>(
    `/coins/${id}/ohlc?vs_currency=usd&days=${days}`,
    300,
  );
  return raw.slice(-limit).map(([time, open, high, low, close]) => ({
    time: Math.floor(time / 1000),
    open,
    high,
    low,
    close,
    volumefrom: 0, // CoinGecko OHLC doesn't include volume
    volumeto: 0,
  }));
}

/** Get daily OHLCV data */
export async function getDailyOhlcv(fsym: string, _tsym = "USD", limit = 30): Promise<OhlcvData[]> {
  const id = await resolveId(fsym);
  // CoinGecko: 30→daily candles, 90→fewer, 365→weekly
  const days = Math.min(Math.max(limit, 30), 365);
  type Resp = [number, number, number, number, number][];
  const raw = await cgFetch<Resp>(
    `/coins/${id}/ohlc?vs_currency=usd&days=${days}`,
    600,
  );
  return raw.slice(-limit).map(([time, open, high, low, close]) => ({
    time: Math.floor(time / 1000),
    open,
    high,
    low,
    close,
    volumefrom: 0,
    volumeto: 0,
  }));
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

/**
 * Get latest crypto news.
 * CoinGecko does not provide a news feed. Returns an empty array.
 * Use the dedicated news modules (gdelt, rss-feeds) instead.
 */
export async function getNews(_categories?: string, _limit = 20): Promise<NewsArticle[]> {
  return [];
}

// ─── Social Stats ──────────────────────────────────────────

interface SocialStats {
  Reddit: { active_users: number; subscribers: number; posts_per_day: number };
  Twitter: { followers: number; statuses: number };
  CryptoCompare: { points: number; followers: number };
}

/**
 * Get social stats for a coin.
 * CoinGecko free API includes some community data in /coins/{id} but not
 * structured social stats. Returns zeroed stubs.
 */
export async function getSocialStats(_coinId: string): Promise<SocialStats> {
  return {
    Reddit: { active_users: 0, subscribers: 0, posts_per_day: 0 },
    Twitter: { followers: 0, statuses: 0 },
    CryptoCompare: { points: 0, followers: 0 },
  };
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
export async function getTopPairs(fsym: string, _tsym = "USD", limit = 10): Promise<TopPair[]> {
  const id = await resolveId(fsym);
  interface Ticker {
    market: { name: string; identifier: string };
    base: string;
    target: string;
    converted_volume: { usd: number };
  }
  interface Resp {
    tickers: Ticker[];
  }
  const data = await cgFetch<Resp>(
    `/coins/${id}/tickers?include_exchange_logo=false&depth=false`,
    300,
  );
  return (data.tickers ?? []).slice(0, limit).map((t) => ({
    exchange: t.market.name,
    fromSymbol: t.base,
    toSymbol: t.target,
    volume24h: t.converted_volume?.usd ?? 0,
    volume24hTo: t.converted_volume?.usd ?? 0,
  }));
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
