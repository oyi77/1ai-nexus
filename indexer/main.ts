import * as http from "http";
import { redis } from "./publisher";
import {
  buildConfig,
  logAvailability,
  type IntegrationConfig,
  cex,
  defillama,
  etherscan,
  alchemy,
  jupiter,
} from "./integrations";
import { startEthereumListener } from "./chains/ethereum";
import { startSolanaListener } from "./chains/solana";
import { startBitcoinListener } from "./chains/bitcoin";

// NEW: batch ingestion layer (opt-in via USE_BATCH_INDEXER=1)
import { startEthereumBatchIndexer } from "./core/evm-batch-indexer";

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "4409", 10);

async function main() {
  console.log("[indexer] starting nexus indexer sidecar...");

  // Build integration config from environment
  const config = buildConfig();
  logAvailability(config);

  // Test Redis connection
  try {
    await redis.ping();
    console.log("[indexer] redis connection OK");
  } catch (err) {
    console.warn("[indexer] redis not available, will retry:", (err as Error).message);
  }

  // Start chain listeners (real-time WebSocket subscriptions)
  const useBatch = process.env.USE_BATCH_INDEXER === "1";

  const starters = [
    startSolanaListener(),
    startBitcoinListener(),
  ];

  if (useBatch) {
    console.log("[indexer] USE_BATCH_INDEXER=1 -> EVM batch indexer enabled");
    starters.push(startEthereumBatchIndexer());
  } else {
    console.log("[indexer] legacy per-wallet EVM indexer active");
    starters.push(startEthereumListener());
  }

  await Promise.allSettled(starters);

  // Start background sync jobs (periodic polling)
  cex.startCexSync(config);
  defillama.startDeFiLlamaSync(config);
  etherscan.startEtherscanPolling(config);

  // Health check HTTP server
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      const health = await buildHealthResponse(config);
      res.writeHead(health.status === "ok" ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
    } else if (req.url === "/integrations") {
      const statuses = await checkIntegrations(config);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(statuses));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HEALTH_PORT, () => {
    console.log(`[indexer] health check on :${HEALTH_PORT}/health`);
    console.log(`[indexer] integration status on :${HEALTH_PORT}/integrations`);
  });
}

async function buildHealthResponse(config: IntegrationConfig) {
  const checks = await checkIntegrations(config);
  const allOk = checks.every((c) => c.status === "ok");
  return {
    status: allOk ? "ok" : "degraded",
    uptime: process.uptime(),
    integrations: checks,
  };
}

async function checkIntegrations(config: IntegrationConfig) {
  const results: Array<{ name: string; status: string; details?: string }> = [];

  // CEX (always available)
  try {
    const cexHealth = await cex.healthCheck(config);
    results.push({
      name: "cex",
      status: cexHealth.ok && cexHealth.exchangeCount! > 0 ? "ok" : "degraded",
      details: cexHealth.ok ? `${cexHealth.exchangeCount} exchanges, ${cexHealth.pairCount} pairs` : cexHealth.error,
    });
  } catch {
    results.push({ name: "cex", status: "error" });
  }

  // DeFiLlama (always available)
  try {
    const dlHealth = await defillama.healthCheck(config);
    results.push({
      name: "defillama",
      status: dlHealth.ok ? "ok" : "error",
      details: dlHealth.ok ? `${dlHealth.protocolCount} protocols` : dlHealth.error,
    });
  } catch {
    results.push({ name: "defillama", status: "error" });
  }

 
  // Jupiter (always available)
  try {
    const jupHealth = await jupiter.healthCheck(config);
    results.push({
      name: "jupiter",
      status: jupHealth.ok ? "ok" : "error",
      details: jupHealth.ok ? `SOL=$${jupHealth.solPrice}` : jupHealth.error,
    });
  } catch {
    results.push({ name: "jupiter", status: "error" });
  }

  // Alchemy (optional)
  results.push({
    name: "alchemy",
    status: alchemy.isAlchemyAvailable(config) ? "ok" : "not_configured",
    details: alchemy.isAlchemyAvailable(config) ? "API key set" : "ALCHEMY_API_KEY not set",
  });

  return results;
}

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
