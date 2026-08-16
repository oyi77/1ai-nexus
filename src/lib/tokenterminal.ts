// ─────────────────────────────────────────────────────────────
// Token Terminal Client — Protocol Fundamentals
// Revenue, fees, P/F ratios, active users, developer activity
// API key required: https://tokenterminal.com/api
// ─────────────────────────────────────────────────────────────

const TT_API_KEY = process.env.TOKEN_TERMINAL_API_KEY ?? "";
const TT_BASE_URL = "https://api.tokenterminal.com/v2";
const TIMEOUT = 15_000;

const CACHE_TTL = {
  PROJECTS: 30 * 60 * 1000, // 30 min
  METRICS: 30 * 60 * 1000,
  PROJECT: 60 * 60 * 1000, // 1 hour
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

async function ttFetch<T>(path: string): Promise<T> {
  if (!TT_API_KEY) throw new Error("TOKEN_TERMINAL_API_KEY not configured");

  const res = await fetch(`${TT_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${TT_API_KEY}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return ttFetch(path); // retry once
  }
  if (!res.ok) throw new Error(`Token Terminal ${path}: ${res.status}`);

  return (await res.json()) as T;
}

export interface TTProject {
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

export interface TTMetric {
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

export interface TTProjectDetail extends TTProject {
  metrics?: TTMetric[];
}

export async function getProjects(limit = 100): Promise<TTProject[]> {
  return cachedFetch(`projects:${limit}`, CACHE_TTL.PROJECTS, async () => {
    const data = await ttFetch<TTProject[]>(`/projects`);
    return data.slice(0, limit);
  });
}

export async function getProject(slug: string): Promise<TTProjectDetail | null> {
  return cachedFetch(`project:${slug}`, CACHE_TTL.PROJECT, async () => {
    try {
      return await ttFetch<TTProjectDetail>(`/projects/${slug}`);
    } catch {
      return null;
    }
  });
}

export async function getLatestMetrics(limit = 200): Promise<TTMetric[]> {
  return cachedFetch(`metrics:latest:${limit}`, CACHE_TTL.METRICS, async () => {
    return await ttFetch<TTMetric[]>(`/metrics/latest?limit=${limit}`);
  });
}

export async function getProjectMetrics(slug: string, limit = 30): Promise<TTMetric[]> {
  return cachedFetch(`metrics:${slug}:${limit}`, CACHE_TTL.METRICS, async () => {
    return await ttFetch<TTMetric[]>(`/projects/${slug}/metrics?limit=${limit}`);
  });
}

export async function getTopProjectsByRevenue(limit = 20): Promise<TTProject[]> {
  const projects = await getProjects(200);
  return projects
    .filter((p) => (p.revenue_30d ?? 0) > 0)
    .sort((a, b) => (b.revenue_30d ?? 0) - (a.revenue_30d ?? 0))
    .slice(0, limit);
}

export async function getTopProjectsByTVL(limit = 20): Promise<TTProject[]> {
  const projects = await getProjects(200);
  return projects
    .filter((p) => (p.total_value_locked ?? 0) > 0)
    .sort((a, b) => (b.total_value_locked ?? 0) - (a.total_value_locked ?? 0))
    .slice(0, limit);
}

export async function getTopProjectsByUsers(limit = 20): Promise<TTProject[]> {
  const projects = await getProjects(200);
  return projects
    .filter((p) => (p.active_users_30d ?? 0) > 0)
    .sort((a, b) => (b.active_users_30d ?? 0) - (a.active_users_30d ?? 0))
    .slice(0, limit);
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  if (!TT_API_KEY) return { ok: false, error: "TOKEN_TERMINAL_API_KEY not set" };
  try {
    await ttFetch("/projects");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}