// ─────────────────────────────────────────────────────────────
// CEX Sync Job for the indexer sidecar
// Periodically syncs CEX market data (exchanges, pairs, liquidations)
// Uses unified CEX client with support for Binance, Bybit, OKX, Hyperliquid, Kraken
// 100% free public endpoints, no API keys required
// ─────────────────────────────────────────────────────────────

import { publishEvent } from "../publisher";
import { type IntegrationConfig } from "./config";
import { cexClient } from "../../src/lib/cex/client";

const CEX_SHORT_INTERVAL = 60_000; // 60 seconds for frequent market updates

export function startCexSync(_config: IntegrationConfig): void {
  void _config;
  console.log("[cex] starting CEX sync job (every 60s)");
  syncLoop();
}

async function syncLoop(): Promise<void> {
  try {
    await Promise.allSettled([
      syncExchangeStatus(),
      syncTopPairs(),
      syncLiquidations(),
    ]);
  } catch (err) {
    console.error("[cex] sync error:", (err as Error).message);
  }

  setTimeout(() => syncLoop(), CEX_SHORT_INTERVAL);
}

async function syncExchangeStatus(): Promise<void> {
  try {
    console.log("[cex] fetching exchange status...");

    const exchangeStatusMap = await cexClient.getExchangeStatus();
    const exchanges = Object.values(exchangeStatusMap);

    const event = {
      source: "cex",
      type: "exchange_status",
      exchanges: exchanges.map((ex) => ({
        id: ex.id,
        name: ex.name,
        status: ex.status,
        spotVolume24hUsd: ex.spotVolumeUsd24h,
        futuresVolume24hUsd: ex.futuresVolumeUsd24h,
        makerFee: ex.makerFee,
        takerFee: ex.takerFee,
        lastUpdate: ex.lastUpdate,
      })),
      timestamp: new Date().toISOString(),
    };

    await publishEvent("nexus:cex:status", event);
    console.log(`[cex] published ${exchanges.length} exchange statuses`);
  } catch (err) {
    console.error("[cex] exchange status sync error:", (err as Error).message);
  }
}

async function syncTopPairs(): Promise<void> {
  try {
    console.log("[cex] fetching top trading pairs...");

    const pairs = await cexClient.getPairs();
    const topPairs = pairs.slice(0, 50); // Top 50 by volume

    const event = {
      source: "cex",
      type: "top_pairs",
      pairCount: topPairs.length,
      pairs: topPairs.map((p) => ({
        id: p.id,
        exchange: p.exchange,
        symbol: p.symbol,
        baseSymbol: p.baseSymbol,
        quoteSymbol: p.quoteSymbol,
        pairType: p.pairType,
        priceUsd: p.priceUsd,
        priceChange24hPercent: p.priceChange24hPercent,
        volumeUsd24h: p.volumeUsd24h,
        fundingRateLatest: p.fundingRateLatest,
        openInterestUsd: p.openInterestUsd,
      })),
      timestamp: new Date().toISOString(),
    };

    await publishEvent("nexus:cex:pairs", event);
    console.log(`[cex] published ${topPairs.length} top trading pairs`);
  } catch (err) {
    console.error("[cex] top pairs sync error:", (err as Error).message);
  }
}

async function syncLiquidations(): Promise<void> {
  try {
    console.log("[cex] fetching liquidations...");

    // Get liquidations from last 24h with minimum $100K
    const liquidations = await cexClient.getLiquidations({
      hours: 24,
      minUsd: 100_000,
    });

    if (liquidations.length === 0) {
      console.log("[cex] no liquidations in 24h window");
      return;
    }

    const event = {
      source: "cex",
      type: "liquidations",
      liquidationCount: liquidations.length,
      liquidations: liquidations.map((liq) => ({
        id: liq.id,
        exchange: liq.exchange,
        symbol: liq.symbol,
        side: liq.side,
        amountUsd: liq.amountUsd,
        amount: liq.amount,
        leverage: liq.leverage,
        price: liq.price,
        timestamp: liq.timestamp,
        isWhaleLiquidation: liq.isWhaleLiquidation,
      })),
      timestamp: new Date().toISOString(),
    };

    await publishEvent("nexus:cex:liquidations", event);
    console.log(
      `[cex] published ${liquidations.length} liquidations (24h, >$100K)`
    );
  } catch (err) {
    console.error("[cex] liquidations sync error:", (err as Error).message);
  }
}

export async function healthCheck(_config: IntegrationConfig): Promise<{
  ok: boolean;
  exchangeCount?: number;
  pairCount?: number;
  error?: string;
}> {
  void _config;
  try {
    // Get enabled exchanges as a proxy for health
    const exchanges = cexClient.getEnabledExchanges();
    if (!exchanges || exchanges.length === 0) {
      return { ok: false, error: "no enabled exchanges" };
    }

    // Try to fetch a small sample of pairs to confirm connectivity
    const pairs = await cexClient.getPairs();
    if (!pairs || pairs.length === 0) {
      return { ok: false, error: "failed to fetch pairs" };
    }

    return {
      ok: true,
      exchangeCount: exchanges.length,
      pairCount: pairs.length,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
