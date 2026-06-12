/**
 * Direct adapter integration test — hits real CEX APIs.
 * Run: npx tsx scripts/test-cex-adapters.ts
 */
import { CexCache } from "../src/lib/cex/cache";
import { CexRateLimiter } from "../src/lib/cex/rate-limiter";
import { BinanceAdapter } from "../src/lib/cex/adapters/binance";
import { BybitAdapter } from "../src/lib/cex/adapters/bybit";
import { OkxAdapter } from "../src/lib/cex/adapters/okx";
import { HyperliquidAdapter } from "../src/lib/cex/adapters/hyperliquid";
import { KrakenAdapter } from "../src/lib/cex/adapters/kraken";

async function main() {
  const cache = new CexCache();
  const rateLimiter = new CexRateLimiter();

  const adapters = [
    new BinanceAdapter(cache, rateLimiter),
    new BybitAdapter(cache, rateLimiter),
    new OkxAdapter(cache, rateLimiter),
    new HyperliquidAdapter(cache, rateLimiter),
    new KrakenAdapter(cache, rateLimiter),
  ];

  for (const adapter of adapters) {
    const id = (adapter as any).exchangeId;
    console.log(`\n=== ${id.toUpperCase()} ===`);

    try {
      console.log("  Status...");
      const status = await adapter.getExchangeStatus();
      console.log(`    id=${status.id} status=${status.status} supports=${JSON.stringify(status.supports)}`);
    } catch (e: any) {
      console.error(`    FAILED: ${e.message}`);
    }

    try {
      console.log("  Pairs (limit 3)...");
      const pairs = await adapter.getPairs();
      const sample = pairs.slice(0, 3).map(p => `${p.baseAsset || p.symbol || "?"}/${p.quoteAsset || "USDT"}`);
      console.log(`    ${pairs.length} pairs (sample: ${sample.join(", ")})`);
    } catch (e: any) {
      console.error(`    FAILED: ${e.message}`);
    }

    try {
      console.log("  Funding rates BTC...");
      const funding = await adapter.getFundingRates("BTC");
      if (funding.length > 0) {
        const f = funding[0];
        console.log(`    ${funding.length} rates — symbol=${f.symbol || "N/A"} rate=${f.fundingRate} time=${new Date(f.timestamp).toISOString()}`);
      } else {
        console.log(`    0 rates (unsupported)`);
      }
    } catch (e: any) {
      console.error(`    FAILED: ${e.message}`);
    }

    try {
      console.log("  Open interest BTC...");
      const oi = await adapter.getOpenInterest("BTC");
      if (oi.length > 0) {
        const o = oi[0];
        console.log(`    ${oi.length} OI — symbol=${o.symbol} oi=${o.openInterestUsd ? "$" + o.openInterestUsd.toLocaleString() : o.openInterest} time=${new Date(o.timestamp).toISOString()}`);
      } else {
        console.log(`    0 OI entries (unsupported)`);
      }
    } catch (e: any) {
      console.error(`    FAILED: ${e.message}`);
    }

    try {
      console.log("  Liquidations (24h)...");
      const liq = await adapter.getLiquidations(24);
      if (liq.length > 0) {
        console.log(`    ${liq.length} liquidations`);
      } else {
        console.log(`    0 liquidations`);
      }
    } catch (e: any) {
      console.error(`    FAILED: ${e.message}`);
    }
  }

  console.log("\n=== ALL DONE ===");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
