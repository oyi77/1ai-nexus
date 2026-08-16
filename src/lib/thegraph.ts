// ─────────────────────────────────────────────────────────────
// The Graph Subgraph Client — Decentralized On-Chain Indexing
// Query subgraphs for DeFi protocols, DEXes, lending, perps
// ─────────────────────────────────────────────────────────────

const GRAPH_API_KEY = process.env.THE_GRAPH_API_KEY ?? "";
const GRAPH_HOSTED_URL = "https://api.thegraph.com/subgraphs/name";
const TIMEOUT = 30_000;

const CACHE_TTL = {
  QUERY: 2 * 60 * 1000, // 2 min
  POOLS: 5 * 60 * 1000, // 5 min
  RESERVES: 5 * 60 * 1000,
  MARKETS: 5 * 60 * 1000,
  METRICS: 10 * 60 * 1000, // 10 min
} as const;

const cache = new Map<string, { data: unknown; expires: number }>();

async function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.data as T;

  const data = await fetcher();
  cache.set(key, { data, expires: now + ttlMs });
  return data;
}

export const SUBGRAPHS = {
  uniswapV3Ethereum: "uniswap/uniswap-v3",
  uniswapV3Arbitrum: "uniswap/uniswap-v3-arbitrum",
  uniswapV3Base: "uniswap/uniswap-v3-base",
  uniswapV3Optimism: "uniswap/uniswap-v3-optimism",
  uniswapV3Polygon: "uniswap/uniswap-v3-polygon",
  sushiswapEthereum: "sushiswap/exchange",
  sushiswapArbitrum: "sushiswap/arbitrum-exchange",
  curveEthereum: "curvefi/curve",
  balancerV2: "balancer/balancer-v2",
  aaveV3Ethereum: "aave/protocol-v3",
  aaveV3Arbitrum: "aave/protocol-v3-arbitrum",
  aaveV3Base: "aave/protocol-v3-base",
  compoundV3: "compound-finance/compound-v3",
  morphoBlue: "morpho-labs/morpho-blue",
  gmxV2: "gmx-io/gmx-v2",
  gmxArbitrum: "gmx-io/gmx-v2-arbitrum",
  hyperliquid: "hyperliquid-dex/hyperliquid",
  lidoEthereum: "lidofinance/lido",
  rocketPool: "rocket-pool/mainnet",
  tokenTerminal: "tokenterminal/tokenterminal",
  messari: "messari/messari",
} as const;

export type SubgraphName = keyof typeof SUBGRAPHS;

interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: (string | number)[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

async function graphFetch<T>(subgraphSlug: string, query: string, variables?: Record<string, unknown>): Promise<T | null> {
  const url = `${GRAPH_HOSTED_URL}/${subgraphSlug}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GRAPH_API_KEY ? { Authorization: `Bearer ${GRAPH_API_KEY}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    const response = (await res.json()) as GraphQLResponse<T>;

    if (response.errors) {
      console.error(`[thegraph] Query errors for ${subgraphSlug}:`, response.errors.map((e) => e.message).join(", "));
      return null;
    }

    return response.data ?? null;
  } catch (err) {
    console.error(`[thegraph] Query failed for ${subgraphSlug}:`, (err as Error).message);
    return null;
  }
}

export async function querySubgraph<T>(subgraph: SubgraphName | string, query: string, variables?: Record<string, unknown>): Promise<T | null> {
  const subgraphSlug = SUBGRAPHS[subgraph as SubgraphName] ?? subgraph;
  const cacheKey = `query:${subgraphSlug}:${Buffer.from(query).toString("base64").slice(0, 50)}`;
  return cachedFetch(cacheKey, CACHE_TTL.QUERY, () => graphFetch<T>(subgraphSlug, query, variables));
}

// ─── Pre-built Queries ────────────────────────────────────

export interface UniswapV3Pool {
  id: string;
  token0: { symbol: string; name: string; decimals: string };
  token1: { symbol: string; name: string; decimals: string };
  feeTier: string;
  liquidity: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  sqrtPrice: string;
}

export async function getUniswapV3Pools(
  chain: "ethereum" | "arbitrum" | "base" | "optimism" | "polygon" = "ethereum",
  first = 50
): Promise<UniswapV3Pool[] | null> {
  const subgraphMap = {
    ethereum: "uniswapV3Ethereum",
    arbitrum: "uniswapV3Arbitrum",
    base: "uniswapV3Base",
    optimism: "uniswapV3Optimism",
    polygon: "uniswapV3Polygon",
  };

  const query = `
    query Pools($first: Int!) {
      pools(first: $first, orderBy: volumeUSD, orderDirection: desc) {
        id
        token0 { symbol name decimals }
        token1 { symbol name decimals }
        feeTier
        liquidity
        volumeUSD
        feesUSD
        txCount
        sqrtPrice
      }
    }
  `;

  return querySubgraph<{ pools: UniswapV3Pool[] }>(subgraphMap[chain], query, { first }).then((res) => res?.pools ?? null);
}

export interface AaveV3Reserve {
  id: string;
  symbol: string;
  name: string;
  decimals: string;
  totalLiquidity: string;
  availableLiquidity: string;
  totalBorrows: string;
  utilizationRate: string;
  liquidityRate: string;
  variableBorrowRate: string;
  stableBorrowRate: string;
  priceUSD: string;
}

export async function getAaveV3Reserves(
  chain: "ethereum" | "arbitrum" | "base" = "ethereum",
  first = 30
): Promise<AaveV3Reserve[] | null> {
  const subgraphMap = {
    ethereum: "aaveV3Ethereum",
    arbitrum: "aaveV3Arbitrum",
    base: "aaveV3Base",
  };

  const query = `
    query Reserves($first: Int!) {
      reserves(first: $first, orderBy: totalLiquidity, orderDirection: desc) {
        id
        symbol
        name
        decimals
        totalLiquidity
        availableLiquidity
        totalBorrows
        utilizationRate
        liquidityRate
        variableBorrowRate
        stableBorrowRate
        priceUSD
      }
    }
  `;

  return querySubgraph<{ reserves: AaveV3Reserve[] }>(subgraphMap[chain], query, { first }).then((res) => res?.reserves ?? null);
}

export interface GMXMarket {
  id: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
  longOpenInterest: string;
  shortOpenInterest: string;
  totalVolume: string;
  totalFees: string;
  fundingRate: string;
  maxLeverage: string;
}

export async function getGMXMarkets(
  chain: "ethereum" | "arbitrum" = "arbitrum"
): Promise<GMXMarket[] | null> {
  const subgraphMap = {
    ethereum: "gmxV2",
    arbitrum: "gmxArbitrum",
  };

  const query = `
    query Markets {
      markets {
        id
        indexToken
        longToken
        shortToken
        longOpenInterest
        shortOpenInterest
        totalVolume
        totalFees
        fundingRate
        maxLeverage
      }
    }
  `;

  return querySubgraph<{ markets: GMXMarket[] }>(subgraphMap[chain], query).then((res) => res?.markets ?? null);
}

export interface LidoData {
  totalPooledEther: string;
  totalShares: string;
  apr: string;
  validatorsCount: number;
}

export async function getLidoData(): Promise<LidoData | null> {
  const query = `
    query Lido {
      lido {
        totalPooledEther
        totalShares
        apr
        validatorsCount
      }
    }
  `;

  return querySubgraph<{ lido: LidoData }>("lidoEthereum", query).then((res) => res?.lido ?? null);
}

export interface CurvePool {
  id: string;
  name: string;
  coins: Array<{ symbol: string; address: string; decimals: string }>;
  volumeUSD: string;
  feesUSD: string;
  virtualPrice: string;
  amp: string;
}

export async function getCurvePools(first = 50): Promise<CurvePool[] | null> {
  const query = `
    query Pools($first: Int!) {
      pools(first: $first, orderBy: volumeUSD, orderDirection: desc) {
        id
        name
        coins { symbol address decimals }
        volumeUSD
        feesUSD
        virtualPrice
        amp
      }
    }
  `;

  return querySubgraph<{ pools: CurvePool[] }>("curveEthereum", query, { first }).then((res) => res?.pools ?? null);
}

export interface TopDeFiMetrics {
  uniswap: { totalVolumeUSD: number; totalFeesUSD: number; poolCount: number };
  aave: { totalLiquidityUSD: number; totalBorrowsUSD: number; reserveCount: number };
  gmx: { totalOI: number; totalVolume: number; marketCount: number };
  lido: { totalStakedETH: number; apr: number };
  curve: { totalVolumeUSD: number; totalFeesUSD: number; poolCount: number };
}

export async function getTopDeFiMetrics(): Promise<TopDeFiMetrics | null> {
  return cachedFetch("top_defi_metrics", CACHE_TTL.METRICS, async () => {
    try {
      const [uniPools, aaveReserves, gmxMarkets, lidoData, curvePools] = await Promise.allSettled([
        getUniswapV3Pools("ethereum", 100),
        getAaveV3Reserves("ethereum", 50),
        getGMXMarkets("arbitrum"),
        getLidoData(),
        getCurvePools(50),
      ]);

      return {
        uniswap: {
          totalVolumeUSD: uniPools.status === "fulfilled" && uniPools.value
            ? uniPools.value.reduce((sum, p) => sum + parseFloat(p.volumeUSD), 0)
            : 0,
          totalFeesUSD: uniPools.status === "fulfilled" && uniPools.value
            ? uniPools.value.reduce((sum, p) => sum + parseFloat(p.feesUSD), 0)
            : 0,
          poolCount: uniPools.status === "fulfilled" && uniPools.value ? uniPools.value.length : 0,
        },
        aave: {
          totalLiquidityUSD: aaveReserves.status === "fulfilled" && aaveReserves.value
            ? aaveReserves.value.reduce((sum, r) => sum + parseFloat(r.totalLiquidity) * parseFloat(r.priceUSD), 0)
            : 0,
          totalBorrowsUSD: aaveReserves.status === "fulfilled" && aaveReserves.value
            ? aaveReserves.value.reduce((sum, r) => sum + parseFloat(r.totalBorrows) * parseFloat(r.priceUSD), 0)
            : 0,
          reserveCount: aaveReserves.status === "fulfilled" && aaveReserves.value ? aaveReserves.value.length : 0,
        },
        gmx: {
          totalOI: gmxMarkets.status === "fulfilled" && gmxMarkets.value
            ? gmxMarkets.value.reduce((sum, m) => sum + parseFloat(m.longOpenInterest) + parseFloat(m.shortOpenInterest), 0)
            : 0,
          totalVolume: gmxMarkets.status === "fulfilled" && gmxMarkets.value
            ? gmxMarkets.value.reduce((sum, m) => sum + parseFloat(m.totalVolume), 0)
            : 0,
          marketCount: gmxMarkets.status === "fulfilled" && gmxMarkets.value ? gmxMarkets.value.length : 0,
        },
        lido: {
          totalStakedETH: lidoData.status === "fulfilled" && lidoData.value
            ? parseFloat(lidoData.value.totalPooledEther) / 1e18
            : 0,
          apr: lidoData.status === "fulfilled" && lidoData.value
            ? parseFloat(lidoData.value.apr)
            : 0,
        },
        curve: {
          totalVolumeUSD: curvePools.status === "fulfilled" && curvePools.value
            ? curvePools.value.reduce((sum, p) => sum + parseFloat(p.volumeUSD), 0)
            : 0,
          totalFeesUSD: curvePools.status === "fulfilled" && curvePools.value
            ? curvePools.value.reduce((sum, p) => sum + parseFloat(p.feesUSD), 0)
            : 0,
          poolCount: curvePools.status === "fulfilled" && curvePools.value ? curvePools.value.length : 0,
        },
      };
    } catch (err) {
      console.error("[thegraph] getTopDeFiMetrics failed:", (err as Error).message);
      return null;
    }
  });
}

export async function healthCheck(): Promise<{ ok: boolean; subgraph?: string; error?: string }> {
  const testQuery = `{ _meta { block { number } } }`;
  try {
    const result = await querySubgraph("uniswapV3Ethereum", testQuery);
    if (result) {
      return { ok: true, subgraph: "uniswapV3Ethereum" };
    }
    return { ok: false, error: "No data returned" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}