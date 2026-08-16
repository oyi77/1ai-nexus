// ─────────────────────────────────────────────────────────────
// The Graph Subgraph Indexing Client
// Decentralized indexing protocol for on-chain data
// Query subgraphs for DeFi protocols, DEXes, lending, etc.
// ─────────────────────────────────────────────────────────────

import { fetchWithRetry } from "./http-client";
import { type IntegrationConfig } from "./config";

/**
 * The Graph hosted service endpoint
 * For decentralized network, use: https://api.thegraph.com/index-node/graphql
 */
const GRAPH_HOSTED_URL = "https://api.thegraph.com/subgraphs/name";

/**
 * Popular subgraphs for DeFi alpha tracking
 */
export const SUBGRAPHS = {
  // DEXes
  uniswapV3Ethereum: "uniswap/uniswap-v3",
  uniswapV3Arbitrum: "uniswap/uniswap-v3-arbitrum",
  uniswapV3Base: "uniswap/uniswap-v3-base",
  uniswapV3Optimism: "uniswap/uniswap-v3-optimism",
  uniswapV3Polygon: "uniswap/uniswap-v3-polygon",
  sushiswapEthereum: "sushiswap/exchange",
  sushiswapArbitrum: "sushiswap/arbitrum-exchange",
  curveEthereum: "curvefi/curve",
  balancerV2: "balancer/balancer-v2",

  // Lending
  aaveV3Ethereum: "aave/protocol-v3",
  aaveV3Arbitrum: "aave/protocol-v3-arbitrum",
  aaveV3Base: "aave/protocol-v3-base",
  compoundV3: "compound-finance/compound-v3",
  morphoBlue: "morpho-labs/morpho-blue",

  // Perps
  gmxV2: "gmx-io/gmx-v2",
  gmxArbitrum: "gmx-io/gmx-v2-arbitrum",
  hyperliquid: "hyperliquid-dex/hyperliquid",

  // Liquid Staking
  lidoEthereum: "lidofinance/lido",
  rocketPool: "rocket-pool/mainnet",

  // Analytics
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

/**
 * Execute a GraphQL query against a subgraph
 */
export async function querySubgraph<T>(
  config: IntegrationConfig,
  subgraph: SubgraphName | string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T | null> {
  const subgraphSlug = SUBGRAPHS[subgraph as SubgraphName] ?? subgraph;
  const url = `${GRAPH_HOSTED_URL}/${subgraphSlug}`;

  try {
    const response = await fetchWithRetry<GraphQLResponse<T>>(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.thegraph?.apiKey ? { Authorization: `Bearer ${config.thegraph.apiKey}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
        maxRetries: 3,
        timeoutMs: 30_000,
      }
    );

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

/**
 * Get Uniswap V3 pool data (liquidity, volume, fees)
 */
export async function getUniswapV3Pools(
  config: IntegrationConfig,
  chain: "ethereum" | "arbitrum" | "base" | "optimism" | "polygon" = "ethereum",
  first: number = 50
): Promise<Array<{
  id: string;
  token0: { symbol: string; name: string; decimals: string };
  token1: { symbol: string; name: string; decimals: string };
  feeTier: string;
  liquidity: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  sqrtPrice: string;
}> | null> {
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

  return querySubgraph(config, subgraphMap[chain], query, { first });
}

/**
 * Get Aave V3 reserve data (supply/borrow rates, utilization)
 */
export async function getAaveV3Reserves(
  config: IntegrationConfig,
  chain: "ethereum" | "arbitrum" | "base" = "ethereum",
  first: number = 30
): Promise<Array<{
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
}>> | null> {
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

  return querySubgraph(config, subgraphMap[chain], query, { first });
}

/**
 * Get GMX V2 market data (open interest, funding, volume)
 */
export async function getGMXMarkets(
  config: IntegrationConfig,
  chain: "ethereum" | "arbitrum" = "arbitrum"
): Promise<Array<{
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
}>> | null> {
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

  return querySubgraph(config, subgraphMap[chain], query);
}

/**
 * Get Lido staking data (stETH supply, APR, validators)
 */
export async function getLidoData(config: IntegrationConfig): Promise<{
  totalPooledEther: string;
  totalShares: string;
  apr: string;
  validatorsCount: number;
} | null> {
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

  return querySubgraph(config, "lidoEthereum", query);
}

/**
 * Get Curve pool data (volume, fees, APY)
 */
export async function getCurvePools(
  config: IntegrationConfig,
  first: number = 50
): Promise<Array<{
  id: string;
  name: string;
  coins: Array<{ symbol: string; address: string; decimals: string }>;
  volumeUSD: string;
  feesUSD: string;
  virtualPrice: string;
  amp: string;
}> | null> {
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

  return querySubgraph(config, "curveEthereum", query, { first });
}

/**
 * Generic subgraph health check
 */
export async function healthCheck(config: IntegrationConfig): Promise<{
  ok: boolean;
  subgraph?: string;
  error?: string;
}> {
  // Test with Uniswap V3 Ethereum (most reliable)
  const testQuery = `{ _meta { block { number } } }`;

  try {
    const result = await querySubgraph(config, "uniswapV3Ethereum", testQuery);
    if (result) {
      return { ok: true, subgraph: "uniswapV3Ethereum" };
    }
    return { ok: false, error: "No data returned" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * High-level: Get top DeFi protocol metrics across chains
 * Aggregates data from multiple subgraphs for dashboard
 */
export async function getTopDeFiMetrics(config: IntegrationConfig): Promise<{
  uniswap: { totalVolumeUSD: number; totalFeesUSD: number; poolCount: number };
  aave: { totalLiquidityUSD: number; totalBorrowsUSD: number; reserveCount: number };
  gmx: { totalOI: number; totalVolume: number; marketCount: number };
  lido: { totalStakedETH: number; apr: number };
  curve: { totalVolumeUSD: number; totalFeesUSD: number; poolCount: number };
} | null> {
  try {
    const [uniPools, aaveReserves, gmxMarkets, lidoData, curvePools] = await Promise.allSettled([
      getUniswapV3Pools(config, "ethereum", 100),
      getAaveV3Reserves(config, "ethereum", 50),
      getGMXMarkets(config, "arbitrum"),
      getLidoData(config),
      getCurvePools(config, 50),
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
}