export const dynamic = "force-dynamic";

import { apiSuccess, apiError } from "@/lib/api/response";
import * as defillama from "@/lib/defillama";
import * as helius from "@/lib/helius";
import * as geckoterminal from "@/lib/geckoterminal";
import * as coinpaprika from "@/lib/coinpaprika";
import * as cryptocompare from "@/lib/cryptocompare";
import * as lunarcrush from "@/lib/lunarcrush";

interface DataSourceStatus {
  name: string;
  category: string;
  available: boolean;
  details: Record<string, unknown>;
  latencyMs?: number;
}

async function timedCheck<T>(name: string, category: string, fn: () => Promise<T>): Promise<DataSourceStatus> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      name,
      category,
      available: true,
      details: result as Record<string, unknown>,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      category,
      available: false,
      details: { error: (err as Error).message },
      latencyMs: Date.now() - start,
    };
  }
}

export async function GET() {
  try {
    const checks = await Promise.allSettled([
      // Live health checks
      timedCheck("DeFiLlama", "DeFi", async () => {
        const h = await defillama.healthCheck();
        return { protocolCount: h.protocolCount };
      }),
      timedCheck("Jupiter/Solana", "Pricing", async () => {
        const h = await helius.healthCheck();
        return { blockHeight: h.blockHeight, heliusAvailable: h.heliusAvailable };
      }),
      timedCheck("GeckoTerminal", "DEX", async () => {
        const h = await geckoterminal.healthCheck();
        return { trendingPools: h.trendingCount };
      }),
      timedCheck("CoinPaprika", "Market", async () => {
        const h = await coinpaprika.healthCheck();
        return { totalCoins: h.totalCoins };
      }),
      timedCheck("CryptoCompare", "Market", async () => {
        const h = await cryptocompare.healthCheck();
        return { btcPrice: h.btcPrice };
      }),
      timedCheck("LunarCrush", "Social", async () => {
        const h = await lunarcrush.healthCheck();
        return { available: h.ok };
      }),
    ]);

    const dynamic: DataSourceStatus[] = checks.map((c) =>
      c.status === "fulfilled" ? c.value : { name: "unknown", category: "unknown", available: false, details: {} }
    );

    // Static config checks
    const staticSources: DataSourceStatus[] = [
      {
        name: "Alchemy",
        category: "RPC",
        available: !!process.env.ALCHEMY_API_KEY,
        details: {
          configured: !!process.env.ALCHEMY_API_KEY,
          chains: process.env.ALCHEMY_API_KEY ? ["eth", "arbitrum", "base", "optimism"] : [],
          features: ["token-balances", "transfers", "nft-data", "enhanced-rpc"],
        },
      },
      {
        name: "Helius",
        category: "Solana",
        available: !!process.env.HELIUS_API_KEY,
        details: {
          configured: !!process.env.HELIUS_API_KEY,
          features: process.env.HELIUS_API_KEY ? ["enriched-tx", "das", "webhooks"] : [],
        },
      },
      {
        name: "Etherscan",
        category: "Explorer",
        available: !!(process.env.ETHERSCAN_API_KEY || process.env.ARBISCAN_API_KEY || process.env.BASESCAN_API_KEY),
        details: {
          eth: !!process.env.ETHERSCAN_API_KEY,
          arbitrum: !!process.env.ARBISCAN_API_KEY,
          base: !!process.env.BASESCAN_API_KEY,
          optimism: !!process.env.OPTIMISM_ETHERSCAN_API_KEY,
          features: ["tx-history", "token-transfers", "gas-prices"],
        },
      },
      {
        name: "RSS Feeds",
        category: "News",
        available: true,
        details: { tier: "free", feedCount: 25, categories: ["breaking", "markets", "defi", "regulation", "technology", "onchain"], sources: ["CoinDesk", "The Block", "Cointelegraph", "Decrypt", "Blockworks", "DL News", "Bitcoin Magazine", "The Defiant", "Bankless", "Messari"] },
      },
      {
        name: "CoinGecko",
        category: "Market",
        available: true,
        details: { tier: "free", rateLimit: "10-30 calls/min" },
      },
      {
        name: "DexScreener",
        category: "DEX",
        available: true,
        details: { tier: "free", rateLimit: "300 calls/min" },
      },
      {
        name: "Polymarket",
        category: "Predictions",
        available: true,
        details: { tier: "free", features: ["markets", "trades", "orderbook"] },
      },
      {
        name: "Blockstream",
        category: "Bitcoin",
        available: true,
        details: { tier: "free", features: ["blocks", "tx", "address", "mempool"] },
      },
      {
        name: "Reservoir",
        category: "NFT",
        available: true,
        details: { tier: "free", features: ["collections", "sales", "floor-price"] },
      },
      {
        name: "FRED",
        category: "Macro",
        available: true,
        details: { tier: "free", features: ["gdp", "cpi", "interest-rates", "employment", "yield-curve"], provider: "Federal Reserve Bank of St. Louis" },
      },
      {
        name: "Exchange Rates API",
        category: "Forex",
        available: true,
        details: { tier: "free", features: ["forex-rates", "major-pairs"], rateLimit: "1500 req/month" },
      },
      {
        name: "CEX - Binance",
        category: "CEX",
        available: true,
        details: { tier: "free", features: ["spot", "futures", "funding-rates", "open-interest"], exchange: "binance", rateLimit: "1200 req/min" },
      },
      {
        name: "CEX - Bybit",
        category: "CEX",
        available: true,
        details: { tier: "free", features: ["spot", "linear-futures", "funding-rates", "liquidations"], exchange: "bybit", rateLimit: "50 req/sec" },
      },
      {
        name: "CEX - OKX",
        category: "CEX",
        available: true,
        details: { tier: "free", features: ["spot", "futures", "funding-rates", "liquidations"], exchange: "okx", rateLimit: "20 req/sec" },
      },
      {
        name: "CEX - Hyperliquid",
        category: "CEX",
        available: true,
        details: { tier: "free", features: ["perps", "funding-rates", "liquidations"], exchange: "hyperliquid", rateLimit: "unlimited" },
      },
      {
        name: "CEX - Kraken",
        category: "CEX",
        available: true,
        details: { tier: "free", features: ["spot", "ticker", "ohlc"], exchange: "kraken", rateLimit: "1 req/sec" },
      },
    ];

    const allSources = [...dynamic, ...staticSources];
    const available = allSources.filter((s) => s.available).length;

    // Group by category
    const byCategory: Record<string, DataSourceStatus[]> = {};
    for (const s of allSources) {
      if (!byCategory[s.category]) byCategory[s.category] = [];
      byCategory[s.category].push(s);
    }

    return apiSuccess({
      sources: allSources,
      byCategory,
      summary: {
        total: allSources.length,
        available,
        unavailable: allSources.length - available,
        coverage: `${Math.round((available / allSources.length) * 100)}%`,
      },
    });
  } catch (error) {
    console.error("GET /api/v1/data-sources error:", error);
    return apiError("Failed to check data sources", 500);
  }
}
