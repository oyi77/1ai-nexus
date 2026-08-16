// ─────────────────────────────────────────────────────────────
// Arkham Intelligence Client — Entity & Wallet Intelligence
// Entity labeling, portfolio tracking, flow visualization
// API key required: https://platform.arkhamintelligence.com/
// ─────────────────────────────────────────────────────────────

const ARKHAM_API_KEY = process.env.ARKHAM_API_KEY ?? "";
const ARKHAM_BASE_URL = "https://api.arkhamintelligence.com/v1";
const TIMEOUT = 15_000;

const CACHE_TTL = {
  ENTITY: 15 * 60 * 1000, // 15 min
  PORTFOLIO: 30 * 60 * 1000, // 30 min
  SEARCH: 60 * 60 * 1000, // 1 hour
  TRANSFERS: 5 * 60 * 1000, // 5 min
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

async function arkhamFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (!ARKHAM_API_KEY) throw new Error("ARKHAM_API_KEY not configured");

  const res = await fetch(`${ARKHAM_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${ARKHAM_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return arkhamFetch(path, options); // retry once
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Arkham ${path}: ${res.status} - ${text}`);
  }

  return (await res.json()) as T;
}

export interface ArkhamEntity {
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

export interface ArkhamTransfer {
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

export interface ArkhamPortfolio {
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

export interface ArkhamSearchResult {
  entity: string;
  type: string;
  chains: string[];
}

export async function getEntity(address: string, chain = "ethereum"): Promise<ArkhamEntity | null> {
  return cachedFetch(`entity:${chain}:${address.toLowerCase()}`, CACHE_TTL.ENTITY, async () => {
    try {
      return await arkhamFetch<ArkhamEntity>(`/address/${address}?chain=${chain}`);
    } catch {
      return null;
    }
  });
}

export async function getEntities(
  addresses: Array<{ address: string; chain: string }>
): Promise<Map<string, ArkhamEntity>> {
  if (!ARKHAM_API_KEY) return new Map();

  const results = new Map<string, ArkhamEntity>();

  // Process in batches of 50
  for (let i = 0; i < addresses.length; i += 50) {
    const batch = addresses.slice(i, i + 50);
    try {
      const response = await arkhamFetch<{ data: ArkhamEntity[] }>(
        "/addresses/batch",
        {
          method: "POST",
          body: JSON.stringify({ addresses: batch }),
        }
      );

      for (const entity of response.data) {
        results.set(`${entity.chain}:${entity.address.toLowerCase()}`, entity);
      }
    } catch (err) {
      console.error("[arkham] batch getEntities failed:", (err as Error).message);
    }
  }

  return results;
}

export async function getTransfers(
  address: string,
  chain = "ethereum",
  limit = 100
): Promise<ArkhamTransfer[]> {
  return cachedFetch(`transfers:${chain}:${address.toLowerCase()}:${limit}`, CACHE_TTL.TRANSFERS, async () => {
    try {
      const response = await arkhamFetch<{ data: ArkhamTransfer[] }>(
        `/transfers/${address}?chain=${chain}&limit=${limit}`
      );
      return response.data;
    } catch {
      return [];
    }
  });
}

export async function getPortfolio(entity: string): Promise<ArkhamPortfolio | null> {
  return cachedFetch(`portfolio:${entity}`, CACHE_TTL.PORTFOLIO, async () => {
    try {
      return await arkhamFetch<ArkhamPortfolio>(`/portfolio/${entity}`);
    } catch {
      return null;
    }
  });
}

export async function searchEntities(query: string): Promise<ArkhamSearchResult[]> {
  return cachedFetch(`search:${query}`, CACHE_TTL.SEARCH, async () => {
    try {
      const response = await arkhamFetch<{ data: ArkhamSearchResult[] }>(
        `/entities/search?q=${encodeURIComponent(query)}`
      );
      return response.data;
    } catch {
      return [];
    }
  });
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  if (!ARKHAM_API_KEY) return { ok: false, error: "ARKHAM_API_KEY not set" };
  try {
    // Test with Vitalik's address
    await arkhamFetch("/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?chain=ethereum");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Helpers ────────────────────────────────────────────────

export function isSmartMoney(entity: ArkhamEntity): boolean {
  const smartTags = ["smart_money", "whale", "fund", "market_maker", "prop_trader", "vc"];
  return (
    entity.tags.some((t) => smartTags.some((st) => t.toLowerCase().includes(st))) ||
    (entity.entity_type === "entity" && entity.usd_balance > 1_000_000)
  );
}

export function isExchange(entity: ArkhamEntity): boolean {
  return entity.entity_type === "exchange" || entity.tags.some((t) => t.toLowerCase() === "exchange");
}

export function calculateRiskScore(entity: ArkhamEntity): number {
  let score = 0;
  if (entity.entity_type === "exchange") score -= 20;
  if (entity.tags.some((t) => ["mixer", "tumbler", "sanctioned"].includes(t.toLowerCase()))) score += 50;
  if (entity.confidence > 0.9) score -= 10;
  if (entity.usd_balance > 10_000_000) score += 10;
  return Math.max(0, Math.min(100, score));
}