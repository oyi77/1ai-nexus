// ─────────────────────────────────────────────────────────────
// Token Terminal Sync Job — Protocol Fundamentals
// Standardized financial statements for crypto protocols
// Revenue, fees, P/F ratios, active users, developer activity
// API key required: https://tokenterminal.com/api
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db";
import { publishEvent } from "../publisher";
import { fetchWithRetry } from "./http-client";
import { type IntegrationConfig } from "./config";

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (less frequent - fundamentals change slowly)

interface TTProject {
  id: string;
  name: string;
  slug: string;
  category: string;
  chain: string;
  chains: string[];
  description: string;
  token_symbol?: string;
  token_address?: string;
  token_price?: number;
  fully_diluted_valuation?: number;
  market_cap?: number;
  total_value_locked?: number;
  revenue_24h?: number;
  revenue_7d?: number;
  revenue_30d?: number;
  fees_24h?: number;
  fees_7d?: number;
  fees_30d?: number;
  price_to_sales_ratio?: number;
  price_to_fees_ratio?: number;
  active_users_24h?: number;
  active_users_7d?: number;
  active_users_30d?: number;
  core_developers_30d?: number;
  total_developers_30d?: number;
  code_commits_30d?: number;
  github_stars?: number;
  created_at: string;
  updated_at: string;
}

interface TTMetric {
  project_id: string;
  date: string;
  revenue?: number;
  fees?: number;
  total_value_locked?: number;
  active_users?: number;
  core_developers?: number;
  price_to_sales_ratio?: number;
  price_to_fees_ratio?: number;
}

export function startTokenTerminalSync(config: IntegrationConfig): void {
  const apiKey = process.env.TOKEN_TERMINAL_API_KEY;
  if (!apiKey) {
    console.log("[tokenterminal] TOKEN_TERMINAL_API_KEY not set, skipping");
    return;
  }
  console.log("[tokenterminal] starting Token Terminal sync job (every 30min)");
  syncLoop(config, apiKey);
}

async function syncLoop(config: IntegrationConfig, apiKey: string): Promise<void> {
  try {
    await Promise.allSettled([
      syncProjects(config, apiKey),
      syncLatestMetrics(config, apiKey),
    ]);
  } catch (err) {
    console.error("[tokenterminal] sync error:", (err as Error).message);
  }

  setTimeout(() => syncLoop(config, apiKey), SYNC_INTERVAL_MS);
}

async function syncProjects(config: IntegrationConfig, apiKey: string): Promise<void> {
  console.log("[tokenterminal] fetching project list...");

  const projects = await fetchWithRetry<TTProject[]>(
    "https://api.tokenterminal.com/v2/projects",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      maxRetries: 2,
      timeoutMs: 30_000,
    }
  );

  // Filter to relevant chains
  const trackedChains = ["ethereum", "arbitrum", "base", "optimism", "polygon", "solana", "avalanche", "bsc"];
  const relevant = projects.filter((p) =>
    p.chains.some((c) => trackedChains.includes(c.toLowerCase()))
  );

  console.log(`[tokenterminal] ${relevant.length} relevant projects of ${projects.length} total`);

  let upserted = 0;
  let skipped = 0;

  for (const p of relevant.slice(0, 300)) {
    const primaryChain = p.chains.find((c) => trackedChains.includes(c.toLowerCase())) ?? p.chains[0];

    try {
      // Upsert into DeFiProtocol with Token Terminal enrichment
      const existing = await prisma.deFiProtocol.findFirst({
        where: { name: p.name, chain: primaryChain.toLowerCase() },
      });

      const data = {
        name: p.name,
        chain: primaryChain.toLowerCase(),
        category: p.category ?? "Unknown",
        tvl: p.total_value_locked ?? 0,
        tvlChange24h: 0, // Will be calculated from metrics
        volume24h: p.fees_24h ?? 0, // Fees as proxy for volume
        uniqueUsers: p.active_users_24h ?? 0,
        smartMoneyInflow: 0,
        // Token Terminal specific fields stored in metadata via extended model
      };

      if (existing) {
        await prisma.deFiProtocol.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await prisma.deFiProtocol.create({ data });
      }
      upserted++;
    } catch (err) {
      console.error(`[tokenterminal] failed to upsert ${p.name}:`, (err as Error).message);
      skipped++;
    }
  }

  console.log(`[tokenterminal] synced ${upserted} protocols (${skipped} skipped)`);

  await publishEvent("nexus:flows", {
    source: "tokenterminal",
    type: "protocol_sync",
    protocolCount: upserted,
    timestamp: new Date().toISOString(),
  });
}

async function syncLatestMetrics(config: IntegrationConfig, apiKey: string): Promise<void> {
  console.log("[tokenterminal] fetching latest metrics...");

  const metrics = await fetchWithRetry<TTMetric[]>(
    "https://api.tokenterminal.com/v2/metrics/latest",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      maxRetries: 2,
      timeoutMs: 30_000,
    }
  );

  // Store key metrics as MarketSnapshot for time-series
  const snapshots = metrics
    .filter((m) => m.revenue !== undefined || m.fees !== undefined || m.total_value_locked !== undefined)
    .slice(0, 200)
    .map((m) => ({
      symbol: m.project_id,
      sourceId: "tokenterminal",
      price: m.price_to_sales_ratio ?? 0,
      change24h: 0,
      volume24h: m.revenue ?? 0,
      marketCap: m.total_value_locked ?? 0,
      timestamp: new Date(m.date).toISOString(),
    }));

  if (snapshots.length > 0) {
    await publishEvent("nexus:prices", {
      source: "tokenterminal",
      type: "fundamental_metrics",
      snapshotCount: snapshots.length,
      snapshots: snapshots.slice(0, 50),
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`[tokenterminal] published ${snapshots.length} fundamental metric snapshots`);
}

export async function healthCheck(_config: IntegrationConfig): Promise<{
  ok: boolean;
  projectCount?: number;
  error?: string;
}> {
  const apiKey = process.env.TOKEN_TERMINAL_API_KEY;
  if (!apiKey) return { ok: false, error: "TOKEN_TERMINAL_API_KEY not set" };

  try {
    const projects = await fetchWithRetry<TTProject[]>(
      "https://api.tokenterminal.com/v2/projects",
      { headers: { Authorization: `Bearer ${apiKey}` }, maxRetries: 1, timeoutMs: 10_000 }
    );
    return { ok: true, projectCount: projects.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Helper: Get protocol fundamentals for a specific project
// ─────────────────────────────────────────────────────────────

export async function getProjectFundamentals(
  config: IntegrationConfig,
  projectSlug: string
): Promise<{
  revenue_30d: number;
  fees_30d: number;
  tvl: number;
  active_users_30d: number;
  p_s_ratio: number;
  p_f_ratio: number;
  core_devs_30d: number;
  total_devs_30d: number;
} | null> {
  const apiKey = process.env.TOKEN_TERMINAL_API_KEY;
  if (!apiKey) return null;

  try {
    const project = await fetchWithRetry<TTProject>(
      `https://api.tokenterminal.com/v2/projects/${projectSlug}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, maxRetries: 2, timeoutMs: 15_000 }
    );

    return {
      revenue_30d: project.revenue_30d ?? 0,
      fees_30d: project.fees_30d ?? 0,
      tvl: project.total_value_locked ?? 0,
      active_users_30d: project.active_users_30d ?? 0,
      p_s_ratio: project.price_to_sales_ratio ?? 0,
      p_f_ratio: project.price_to_fees_ratio ?? 0,
      core_devs_30d: project.core_developers_30d ?? 0,
      total_devs_30d: project.total_developers_30d ?? 0,
    };
  } catch {
    return null;
  }
}