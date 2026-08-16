// ─────────────────────────────────────────────────────────────
// Arkham Intelligence Integration — Entity Enrichment
// Wallet labeling, entity clustering, flow visualization
// API key required: https://platform.arkhamintelligence.com/
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db";
import { fetchWithRetry } from "./http-client";
import { type IntegrationConfig } from "./config";

interface ArkhamEntity {
  address: string;
  chain: string;
  entity: string;
  entity_type: string;
  confidence: number;
  tags: string[];
  first_seen: string;
  last_seen: string;
  usd_balance: number;
  token_balances: Array<{
    address: string;
    symbol: string;
    balance: string;
    usd_value: number;
  }>;
}

interface ArkhamTransfer {
  from: string;
  to: string;
  from_entity?: string;
  to_entity?: string;
  token: string;
  token_symbol: string;
  amount: string;
  usd_value: number;
  timestamp: string;
  tx_hash: string;
  chain: string;
}

interface ArkhamPortfolio {
  entity: string;
  total_usd: number;
  chains: Record<string, number>;
  top_holdings: Array<{
    token: string;
    symbol: string;
    balance: string;
    usd_value: number;
    chain: string;
  }>;
}

/**
 * Arkham API client for entity enrichment
 * Used by processors to label wallets and detect smart money
 */
export const arkhamClient = {
  /** Get entity info for a single address */
  async getEntity(
    config: IntegrationConfig,
    address: string,
    chain: string = "ethereum"
  ): Promise<ArkhamEntity | null> {
    const apiKey = config.arkham?.apiKey ?? process.env.ARKHAM_API_KEY;
    if (!apiKey) return null;

    try {
      const entity = await fetchWithRetry<ArkhamEntity>(
        `https://api.arkhamintelligence.com/v1/address/${address}?chain=${chain}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          maxRetries: 2,
          timeoutMs: 15_000,
        }
      );
      return entity;
    } catch (err) {
      console.error(`[arkham] getEntity failed for ${address}:`, (err as Error).message);
      return null;
    }
  },

  /** Batch get entities for multiple addresses */
  async getEntities(
    config: IntegrationConfig,
    addresses: Array<{ address: string; chain: string }>
  ): Promise<Map<string, ArkhamEntity>> {
    const apiKey = config.arkham?.apiKey ?? process.env.ARKHAM_API_KEY;
    if (!apiKey) return new Map();

    const results = new Map<string, ArkhamEntity>();

    // Process in batches of 50 (Arkham limit)
    for (let i = 0; i < addresses.length; i += 50) {
      const batch = addresses.slice(i, i + 50);
      try {
        const response = await fetchWithRetry<{ data: ArkhamEntity[] }>(
          "https://api.arkhamintelligence.com/v1/addresses/batch",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ addresses: batch }),
            maxRetries: 2,
            timeoutMs: 30_000,
          }
        );

        for (const entity of response.data) {
          results.set(`${entity.chain}:${entity.address.toLowerCase()}`, entity);
        }
      } catch (err) {
        console.error(`[arkham] batch getEntities failed:`, (err as Error).message);
      }
    }

    return results;
  },

  /** Get recent transfers for an entity/address */
  async getTransfers(
    config: IntegrationConfig,
    address: string,
    chain: string = "ethereum",
    limit: number = 100
  ): Promise<ArkhamTransfer[]> {
    const apiKey = config.arkham?.apiKey ?? process.env.ARKHAM_API_KEY;
    if (!apiKey) return [];

    try {
      const response = await fetchWithRetry<{ data: ArkhamTransfer[] }>(
        `https://api.arkhamintelligence.com/v1/transfers/${address}?chain=${chain}&limit=${limit}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          maxRetries: 2,
          timeoutMs: 15_000,
        }
      );
      return response.data;
    } catch (err) {
      console.error(`[arkham] getTransfers failed for ${address}:`, (err as Error).message);
      return [];
    }
  },

  /** Get portfolio for an entity */
  async getPortfolio(
    config: IntegrationConfig,
    entity: string
  ): Promise<ArkhamPortfolio | null> {
    const apiKey = config.arkham?.apiKey ?? process.env.ARKHAM_API_KEY;
    if (!apiKey) return null;

    try {
      const portfolio = await fetchWithRetry<ArkhamPortfolio>(
        `https://api.arkhamintelligence.com/v1/portfolio/${entity}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          maxRetries: 2,
          timeoutMs: 15_000,
        }
      );
      return portfolio;
    } catch (err) {
      console.error(`[arkham] getPortfolio failed for ${entity}:`, (err as Error).message);
      return null;
    }
  },

  /** Search entities by name */
  async searchEntities(
    config: IntegrationConfig,
    query: string
  ): Promise<Array<{ entity: string; type: string; chains: string[] }>> {
    const apiKey = config.arkham?.apiKey ?? process.env.ARKHAM_API_KEY;
    if (!apiKey) return [];

    try {
      const response = await fetchWithRetry<{ data: Array<{ entity: string; type: string; chains: string[] }> }>(
        `https://api.arkhamintelligence.com/v1/entities/search?q=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          maxRetries: 2,
          timeoutMs: 10_000,
        }
      );
      return response.data;
    } catch (err) {
      console.error(`[arkham] searchEntities failed:`, (err as Error).message);
      return [];
    }
  },
};

/**
 * Enrich wallet records in database with Arkham labels
 * Call from processors after new wallets are discovered
 */
export async function enrichWalletsWithArkham(
  config: IntegrationConfig,
  walletAddresses: Array<{ address: string; chain: string }>
): Promise<{
  enriched: number;
  smartMoneyFound: number;
  exchangeFound: number;
}> {
  console.log(`[arkham] enriching ${walletAddresses.length} wallets...`);

  const entities = await arkhamClient.getEntities(config, walletAddresses);
  let enriched = 0;
  let smartMoneyFound = 0;
  let exchangeFound = 0;

  for (const [key, entity] of entities) {
    const [chain, address] = key.split(":");
    try {
      // Update wallet with entity info
      await prisma.wallet.update({
        where: { address_chain: { address, chain } },
        data: {
          entityId: entity.entity,
          labels: [
            ...new Set([
              entity.entity_type,
              ...entity.tags,
              ...(entity.confidence > 0.8 ? ["high_confidence"] : []),
            ]),
          ],
          riskScore: calculateRiskScore(entity),
        },
      });

      // Track smart money / exchange wallets
      if (isSmartMoney(entity)) {
        await upsertSmartMoneyWallet(entity);
        smartMoneyFound++;
      }
      if (isExchange(entity)) {
        exchangeFound++;
      }

      enriched++;
    } catch (err) {
      console.error(`[arkham] failed to enrich ${address}:`, (err as Error).message);
    }
  }

  console.log(`[arkham] enriched ${enriched} wallets (${smartMoneyFound} smart money, ${exchangeFound} exchange)`);
  return { enriched, smartMoneyFound, exchangeFound };
}

function calculateRiskScore(entity: ArkhamEntity): number {
  let score = 0;
  // Exchange = lower risk (known entity)
  if (entity.entity_type === "exchange") score -= 20;
  // Mixer/tumbler = higher risk
  if (entity.tags.some((t) => ["mixer", "tumbler", "sanctioned"].includes(t.toLowerCase()))) score += 50;
  // High confidence label
  if (entity.confidence > 0.9) score -= 10;
  // Large balance = more attention
  if (entity.usd_balance > 10_000_000) score += 10;
  return Math.max(0, Math.min(100, score));
}

function isSmartMoney(entity: ArkhamEntity): boolean {
  const smartTags = ["smart_money", "whale", "fund", "market_maker", "prop_trader", "vc"];
  return (
    entity.tags.some((t) => smartTags.some((st) => t.toLowerCase().includes(st))) ||
    (entity.entity_type === "entity" && entity.usd_balance > 1_000_000)
  );
}

function isExchange(entity: ArkhamEntity): boolean {
  return entity.entity_type === "exchange" || entity.tags.some((t) => t.toLowerCase() === "exchange");
}

async function upsertSmartMoneyWallet(entity: ArkhamEntity): Promise<void> {
  const wallet = await prisma.wallet.findUnique({
    where: { address_chain: { address: entity.address, chain: entity.chain } },
  });
  if (!wallet) return;

  const category = entity.tags.find((t) =>
    ["fund", "market_maker", "prop_trader", "vc", "whale"].some((c) => t.toLowerCase().includes(c))
  ) ?? "unknown";

  await prisma.smartMoneyWallet.upsert({
    where: { walletId: wallet.id },
    create: {
      walletId: wallet.id,
      category,
      score: Math.min(100, entity.confidence * 100),
    },
    update: {
      category,
      score: Math.min(100, entity.confidence * 100),
    },
  });
}

export async function healthCheck(config: IntegrationConfig): Promise<{
  ok: boolean;
  error?: string;
}> {
  const apiKey = config.arkham?.apiKey ?? process.env.ARKHAM_API_KEY;
  if (!apiKey) return { ok: false, error: "ARKHAM_API_KEY not set" };

  try {
    // Test with a known address (Vitalik)
    await fetchWithRetry(
      "https://api.arkhamintelligence.com/v1/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?chain=ethereum",
      { headers: { Authorization: `Bearer ${apiKey}` }, maxRetries: 1, timeoutMs: 10_000 }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}