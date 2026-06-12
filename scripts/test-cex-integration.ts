/**
 * Integration test — hits real CEX APIs and FRED macro endpoint.
 * Run: npx tsx scripts/test-cex-integration.ts
 */
import { CexClient } from "../src/lib/cex/client";
import { CexCache } from "../src/lib/cex/cache";
import { CexRateLimiter } from "../src/lib/cex/rate-limiter";

async function testCexAdapters() {
  console.log("=== CEX ADAPTER INTEGRATION TEST ===\n");

  const cache = new CexCache();
  const rateLimiter = new CexRateLimiter();
  const client = new CexClient(cache, rateLimiter);

  const start = Date.now();

  // 1. Exchange Status
  console.log("--- getExchangeStatus ---");
  const statuses = await client.getAllExchangeStatus();
  for (const exc of statuses) {
    console.log(`  ${exc.id}: status=${exc.status} fee=${exc.makerFee}/${exc.takerFee} supports=${JSON.stringify(exc.supports)} lastUpdate=${new Date(exc.lastUpdate).toISOString()}`);
  }

  // 2. Pairs
  console.log("\n--- getPairs (all) ---");
  const pairs = await client.getExchangeData("pairs", {});
  for (const [exchangeId, data] of Object.entries(pairs)) {
    const d = data as any[];
    console.log(`  ${exchangeId}: ${d.length} pairs`);
    if (d.length > 0) {
      console.log(`    sample: ${d.slice(0, 3).map(p => `${p.symbol || p.pair || p.id}`).join(", ")}`);
    }
  }

  // 3. Funding Rates (BTC)
  console.log("\n--- getFundingRates (BTC) ---");
  const funding = await client.getExchangeData("funding", { symbol: "BTC" });
  for (const [exchangeId, data] of Object.entries(funding)) {
    const d = data as any[];
    console.log(`  ${exchangeId}: ${d.length} rates`);
    if (d.length > 0) {
      console.log(`    sample: symbol=${d[0].symbol || "N/A"} rate=${d[0].fundingRate || d[0].rate || "N/A"}`);
    }
  }

  // 4. Open Interest (BTC)
  console.log("\n--- getOpenInterest (BTC) ---");
  const oi = await client.getExchangeData("openInterest", { symbol: "BTC" });
  for (const [exchangeId, data] of Object.entries(oi)) {
    const d = data as any[];
    console.log(`  ${exchangeId}: ${d.length} OI entries`);
    if (d.length > 0) {
      console.log(`    sample: symbol=${d[0].symbol || "N/A"} oi=${d[0].openInterest || d[0].oi || "N/A"}`);
    }
  }

  // 5. Cross-market summary
  console.log("\n--- cross-market summary ---");
  const summary = await client.getExchangeData("summary", {});
  console.log(`  exchanges: ${Object.keys(summary).length}`);
  for (const [exc, data] of Object.entries(summary)) {
    const d = data as any;
    console.log(`  ${exc}: pairs=${d.pairsCount || 0} funding=${d.fundingCount || 0} oi=${d.oiCount || 0}`);
  }

  const elapsed = ((monotonicNow() - start) / 1000).toFixed(1);
  console.log(`\n=== DONE in ${elapsed}s ===`);
}

testCexAdapters().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
