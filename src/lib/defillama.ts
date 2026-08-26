// ─────────────────────────────────────────────────────────────
// DeFiLlama API Client (100% free, no auth needed)
// Docs: https://defillama.com/docs/api
// ─────────────────────────────────────────────────────────────

const BASE = "https://api.llama.fi";
const YIELDS_BASE = "https://yields.llama.fi";
const COINS_BASE = "https://coins.llama.fi";
const STABLECOINS_BASE = "https://stablecoins.llama.fi";
const BRIDGES_BASE = "https://bridges.llama.fi";

async function fetchJson<T>(url: string, cacheSec = 120): Promise<T> {
  const res = await fetch(url, {
    next: { revalidate: cacheSec },
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
  });
  if (!res.ok) throw new Error(`DeFiLlama ${url} error: ${res.status}`);
  return res.json();
}

// ─── Protocols & TVL ──────────────────────────────────────

export interface ProtocolSummary {
  id: string;
  name: string;
  address?: string;
  symbol?: string;
  url?: string;
  description?: string;
  chain: string;
  chains: string[];
  tvl: number;
  change_1h?: number;
  change_1d?: number;
  change_7d?: number;
  mcap?: number;
  category?: string;
  tvlPrev1d?: number;
  tvlPrev7d?: number;
  tvlPrev1m?: number;
}

/** List all protocols with TVL */
export async function getProtocols(): Promise<ProtocolSummary[]> {
  return fetchJson(`${BASE}/protocols`, 300);
}

/** Get TVL for a single protocol by slug */
export async function getProtocol(slug: string) {
  return fetchJson<Record<string, unknown>>(`${BASE}/protocol/${slug}`, 300);
}

/** Get historical TVL for a protocol */
export async function getProtocolTvlHistory(slug: string) {
  type TvlHistory = { tvl: Array<{ date: number; totalLiquidityUSD: number }> };
  return fetchJson<TvlHistory>(`${BASE}/protocol/${slug}`, 300);
}

/** Get TVL for a specific chain */
export async function getChainTvl(chain: string) {
  type ChainTvl = { tvl: Array<{ date: number; totalLiquidityUSD: number }> };
  return fetchJson<ChainTvl>(`${BASE}/v2/historicalChainTvl/${chain}`, 300);
}

/** Get TVL breakdown by chain */
export async function getChainsTvl() {
  return fetchJson<
    Array<{
      gecko_id: string;
      tvl: number;
      tokenSymbol: string;
      name: string;
      chainId: number;
    }>
  >(`${BASE}/v2/chains`, 300);
}

// ─── Yields ───────────────────────────────────────────────

export interface YieldPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase?: number;
  apyReward?: number;
  pool: string;
  poolMeta?: string;
  stablecoin?: boolean;
  ilRisk?: string;
  exposure?: string;
  predictions?: {
    predictedClass: string;
    predictedProbability: number;
    binnedConfidence: number;
  };
}

/** List all yield pools (heavy, cached aggressively) */
export async function getYieldPools(): Promise<{ data: YieldPool[] }> {
  return fetchJson(`${YIELDS_BASE}/pools`, 600);
}

/** Get yield pools for a specific protocol */
export async function getYieldPoolsForProject(project: string) {
  const all = await getYieldPools();
  return all.data.filter((p) => p.project === project);
}

/** Get best APY pools (top N) */
export async function getTopYieldPools(
  chain?: string,
  stablecoinOnly = false,
  limit = 50
): Promise<YieldPool[]> {
  const all = await getYieldPools();
  let pools = all.data.filter((p) => p.tvlUsd > 1_000_000); // Filter small pools
  if (chain) pools = pools.filter((p) => p.chain.toLowerCase() === chain.toLowerCase());
  if (stablecoinOnly) pools = pools.filter((p) => p.stablecoin);
  return pools.sort((a, b) => b.apy - a.apy).slice(0, limit);
}

// ─── DEX Volume ───────────────────────────────────────────

export interface DexVolume {
  dailyVolume: number;
  totalVolume24h: number;
}

/** Get DEX volume overview */
export async function getDexVolumes() {
  return fetchJson<Record<string, unknown>>(`${BASE}/overview/dex`, 300);
}

/** Get DEX volume for a specific chain */
export async function getDexVolumeByChain(chain: string) {
  return fetchJson<Record<string, unknown>>(`${BASE}/overview/dex/${chain}`, 300);
}

// ─── Stablecoins ──────────────────────────────────────────

export interface Stablecoin {
  id: string;
  name: string;
  symbol: string;
  pegType: string;
  circulating: { peggedUSD: number };
  chainCirculating: Record<string, { current: { peggedUSD: number } }>;
}

/** List all tracked stablecoins */
export async function getStablecoins(includePrices = false) {
  return fetchJson<{ peggedAssets: Stablecoin[] }>(
    `${STABLECOINS_BASE}/stablecoins?includePrices=${includePrices}`,
    300
  );
}

/** Get stablecoin chain breakdown */
export async function getStablecoinChainBreakdown() {
  return fetchJson<Record<string, unknown>>(`${STABLECOINS_BASE}/stablecoinchains`, 300);
}

// ─── Token Prices ─────────────────────────────────────────

export interface CoinPrice {
  decimals: number;
  price: number;
  symbol: string;
  timestamp: number;
}

/** Get current prices for coins (format: "coingecko:ethereum" or "ethereum:0x...") */
export async function getCoinsPrices(
  coins: string[],
  searchWidth?: string
): Promise<{ coins: Record<string, CoinPrice> }> {
  const params = new URLSearchParams({ coins: coins.join(",") });
  if (searchWidth) params.set("searchWidth", searchWidth);
  return fetchJson(`${COINS_BASE}/prices/current/${coins.join(",")}`, 60);
}

/** Get historical prices at a timestamp */
export async function getCoinsPricesAt(
  timestamp: number,
  coins: string[]
): Promise<{ coins: Record<string, CoinPrice> }> {
  return fetchJson(`${COINS_BASE}/prices/historical/${timestamp}/${coins.join(",")}`, 600);
}

// ─── Bridges ──────────────────────────────────────────────

/** Get bridge volume overview */
export async function getBridgeOverview() {
  return fetchJson<Record<string, unknown>>(`${BRIDGES_BASE}/overview`, 300);
}

/** Get bridge volume for a specific chain */
export async function getBridgeVolumeByChain(chain: string) {
  return fetchJson<Record<string, unknown>>(`${BRIDGES_BASE}/overview/${chain}`, 300);
}

// ─── Fees & Revenue ───────────────────────────────────────

/** Get protocol fees overview */
export async function getFeesOverview() {
  return fetchJson<Record<string, unknown>>(`${BASE}/overview/fees`, 300);
}

// ─── Utility ──────────────────────────────────────────────

/** Health check */
export async function healthCheck(): Promise<{ ok: boolean; protocolCount?: number; error?: string }> {
  try {
    const protocols = await getProtocols();
    return { ok: true, protocolCount: protocols.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Get top protocols by TVL for NEXUS DeFi page */
export async function getTopDeFiProtocols(chain?: string, limit = 50): Promise<
  Array<{
    name: string;
    chain: string;
    chains: string[];
    category: string;
    tvl: number;
    change1d: number;
    change7d: number;
    mcap: number;
  }>
> {
  const protocols = await getProtocols();
  let filtered = protocols;
  if (chain) {
    filtered = protocols.filter(
      (p) => p.chains.map((c) => c.toLowerCase()).includes(chain.toLowerCase())
    );
  }
  return filtered
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      chain: p.chain || p.chains[0] || "",
      chains: p.chains,
      category: p.category || "Unknown",
      tvl: p.tvl,
      change1d: p.change_1d ?? 0,
      change7d: p.change_7d ?? 0,
      mcap: p.mcap ?? 0,
    }));
}
