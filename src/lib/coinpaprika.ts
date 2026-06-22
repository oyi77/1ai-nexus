// ─────────────────────────────────────────────────────────────
// CoinPaprika API Client (100% free, no auth needed)
// Docs: https://api.coinpaprika.com/
// 50K+ assets, tickers, historical data, global market overview
// ─────────────────────────────────────────────────────────────

const BASE = "https://api.coinpaprika.com/v1";

async function cpFetch<T>(path: string, cacheSec = 60): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    next: { revalidate: cacheSec },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`CoinPaprika ${path}: ${res.status}`);
  return (await res.json()) as T;
}

// ─── Raw API types (matches actual CoinPaprika response) ───

interface RawTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number | null;
  beta_value: number;
  first_data_at: string;
  last_updated: string;
  quotes: {
    USD: {
      price: number;
      volume_24h: number;
      volume_24h_change_24h: number;
      market_cap: number;
      market_cap_change_24h: number;
      percent_change_15m: number;
      percent_change_30m: number;
      percent_change_1h: number;
      percent_change_6h: number;
      percent_change_12h: number;
      percent_change_24h: number;
      percent_change_7d: number;
      percent_change_30d: number;
      percent_change_1y: number;
      ath_price: number;
      ath_date: string;
      percent_from_price_ath: number;
    };
  };
}

// ─── Cleaned types ─────────────────────────────────────────

export interface Ticker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  price: number;
  volume24h: number;
  marketCap: number;
  change1h: number;
  change24h: number;
  change7d: number;
  change30d: number;
  change1y: number;
  athPrice: number;
  athDate: string;
  athDrop: number;
  circulatingSupply: number;
  totalSupply: number;
  maxSupply: number | null;
}

function mapTicker(raw: RawTicker): Ticker {
  const q = raw.quotes.USD;
  return {
    id: raw.id,
    name: raw.name,
    symbol: raw.symbol,
    rank: raw.rank,
    price: q.price,
    volume24h: q.volume_24h,
    marketCap: q.market_cap,
    change1h: q.percent_change_1h,
    change24h: q.percent_change_24h,
    change7d: q.percent_change_7d,
    change30d: q.percent_change_30d,
    change1y: q.percent_change_1y,
    athPrice: q.ath_price,
    athDate: q.ath_date,
    athDrop: q.percent_from_price_ath,
    circulatingSupply: raw.circulating_supply,
    totalSupply: raw.total_supply,
    maxSupply: raw.max_supply,
  };
}

// ─── Global Market Data ────────────────────────────────────

export interface GlobalData {
  market_cap_usd: number;
  volume_24h_usd: number;
  bitcoin_dominance_percentage: number;
  cryptocurrencies_number: number;
  market_cap_ath_value: number;
  market_cap_ath_date: string;
  volume_24h_ath_value: number;
  volume_24h_ath_date: string;
  market_cap_change_24h: number;
  volume_24h_change_24h: number;
  last_updated: number;
}

export async function getGlobal(): Promise<GlobalData> {
  return cpFetch("/global", 120);
}

// ─── Tickers ───────────────────────────────────────────────

export async function getTickers(limit = 100): Promise<Ticker[]> {
  const raw = await cpFetch<RawTicker[]>(`/tickers?limit=${Math.min(limit, 100)}`, 120);
  return raw.map(mapTicker);
}

export async function getTicker(coinId: string): Promise<Ticker> {
  const raw = await cpFetch<RawTicker>(`/tickers/${coinId}`, 60);
  return mapTicker(raw);
}

// ─── Coins List ────────────────────────────────────────────

interface CoinSummary {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  is_new: boolean;
  is_active: boolean;
  type: string;
}

export async function getCoins(): Promise<CoinSummary[]> {
  return cpFetch("/coins", 600);
}

// ─── OHLCV ────────────────────────────────────────────────

export interface Ohlcv {
  time_open: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  market_cap: number;
}

export async function getOhlcv(coinId: string, days = 7): Promise<Ohlcv[]> {
  return cpFetch(`/coins/${coinId}/ohlcv/historical?days=${days}`, 300);
}

// ─── Exchanges ─────────────────────────────────────────────

export interface Exchange {
  id: string;
  name: string;
  active: boolean;
  pairs: number;
  url: string;
  rank: number;
  adjusted_volume_24h_share: number;
  currencies: number;
  markets: number;
}

export async function getExchanges(limit = 20): Promise<Exchange[]> {
  return cpFetch(`/exchanges?limit=${Math.min(limit, 100)}`, 300);
}

// ─── Utility ──────────────────────────────────────────────

export async function getMarketOverview(): Promise<{
  totalMarketCap: number;
  volume24h: number;
  btcDominance: number;
  totalCoins: number;
  topCoins: Array<{
    name: string;
    symbol: string;
    price: number;
    change24h: number;
    marketCap: number;
    volume24h: number;
  }>;
}> {
  const [global, tickers] = await Promise.all([getGlobal(), getTickers(10)]);
  return {
    totalMarketCap: global.market_cap_usd,
    volume24h: global.volume_24h_usd,
    btcDominance: global.bitcoin_dominance_percentage,
    totalCoins: global.cryptocurrencies_number,
    topCoins: tickers.map((t) => ({
      name: t.name,
      symbol: t.symbol,
      price: t.price,
      change24h: t.change24h,
      marketCap: t.marketCap,
      volume24h: t.volume24h,
    })),
  };
}

export async function healthCheck(): Promise<{ ok: boolean; totalCoins?: number; error?: string }> {
  try {
    const global = await getGlobal();
    return { ok: true, totalCoins: global.cryptocurrencies_number };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
