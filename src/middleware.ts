import { NextResponse, type NextRequest } from "next/server";
const ALLOWED_ORIGINS = [
  'https://tracker.aitradepulse.com',
  'http://localhost:4400',
  'http://localhost:3000',
];
const API_KEYS = new Set(
  (process.env.NEXUS_API_KEYS || "").split(",").filter(Boolean)
);

// Routes that don't require API key auth (public — used by frontend pages)
const PUBLIC_API_ROUTES = new Set([
  "/api/v1/data-sources",
  "/api/v1/defillama",
  "/api/v1/feed",
  "/api/v1/fear-greed",
  "/api/v1/feeds",
  "/api/v1/macro",
  "/api/v1/market",
  "/api/v1/market/flow",
  "/api/v1/market/prices",
  "/api/v1/market/sentiment",
  "/api/v1/ohlcv",
  "/api/v1/sectors",
  "/api/v1/alt-data",
  "/api/v1/stablecoins",
  "/api/v1/vimero",
  "/api/v1/trending",
  "/api/v1/news",
  "/api/v1/tokens",
  "/api/v1/tokens/discover",
  "/api/v1/entities",
  "/api/v1/smart-money",
  "/api/v1/smart-money/flow",
  "/api/v1/smart-money/wallet",
  "/api/v1/flows",
  "/api/v1/alerts",
  "/api/v1/alerts/templates",
  "/api/v1/defi/tvl",
  "/api/v1/defi/yields",
  "/api/v1/defi/overview",
  "/api/v1/history",
  "/api/v1/exchange-flow",
  "/api/v1/sentiment",
  "/api/v1/wallets",
  "/api/v1/modules",
  "/api/v1/cron",
  "/api/v1/derivatives",
  "/api/v1/signal-confidence",
  "/api/v1/status",
  "/api/v1/correlations",
  "/api/v1/pnl",
  "/api/v1/telegram",
  "/api/v1/macro-onchain",
  "/api/v1/copy-trade",
  "/api/v1/edge-report",
  "/api/v1/hyperliquid",
  "/api/v1/exchanges",
  "/api/v1/alpha-feed",
  "/api/v1/workspaces",
  "/api/v1/gaps",
  "/api/v1/weather-signals",
  "/api/v1/news-intel",
  "/api/v1/tradfi",
  "/api/auth",
]);

// ─── Rate Limiting (in-memory, per-edge instance) ──────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
}

function checkRateLimit(key: string, maxRequests = 100, windowMs = 60_000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  entry.count++;
  const remaining = Math.max(0, maxRequests - entry.count);
  return { allowed: entry.count <= maxRequests, remaining };
}

// ─── Usage Tracking (in-memory, per-edge instance) ─────────

interface UsageEntry {
  totalCalls: number;
  lastCalledAt: number;
  endpoints: Record<string, number>;
}

const usageMap = new Map<string, UsageEntry>();

function trackUsage(apiKey: string, pathname: string): void {
  const now = Date.now();
  let entry = usageMap.get(apiKey);

  if (!entry) {
    entry = { totalCalls: 0, lastCalledAt: now, endpoints: {} };
    usageMap.set(apiKey, entry);
  }

  entry.totalCalls++;
  entry.lastCalledAt = now;
  entry.endpoints[pathname] = (entry.endpoints[pathname] || 0) + 1;
}

/** Get usage stats for an API key (callable from API routes) */
export function getUsage(apiKey: string): UsageEntry | null {
  return usageMap.get(apiKey) ?? null;
}

/** Get all usage stats (admin endpoint) */
export function getAllUsage(): Record<string, UsageEntry> {
  const result: Record<string, UsageEntry> = {};
  usageMap.forEach((entry, key) => {
    result[key] = { ...entry };
  });
  return result;
}

// ─── Middleware ─────────────────────────────────────────────

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const startTime = Date.now();

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Skip public routes
  if (PUBLIC_API_ROUTES.has(pathname) || pathname.startsWith("/api/auth/")) {
    return addCorsHeaders(NextResponse.next(), request);
  }
  // Legacy routes (used by frontend) — rate limit + deprecation warning
  if (!pathname.startsWith("/api/v1/")) {
    console.warn(`[AUTH] Legacy API route accessed: ${pathname}. Migrate to /api/v1/ endpoints.`);
    const ip = getClientIp(request);
    const { allowed, remaining } = checkRateLimit(`legacy:${ip}`);
    if (!allowed) {
      return NextResponse.json(
        { data: null, error: "Rate limit exceeded" },
        { status: 429, headers: { "X-RateLimit-Remaining": "0" } }
      );
    }
    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Limit", "100");
    response.headers.set("Deprecation", "true");
    return addCorsHeaders(response, request);
  }

  // v1 routes require API key
  if (API_KEYS.size > 0) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { data: null, error: "Missing API key. Use Authorization: Bearer <key>" },
        { status: 401 }
      );
    }

    const key = authHeader.slice(7);
    if (!API_KEYS.has(key)) {
      return NextResponse.json(
        { data: null, error: "Invalid API key" },
        { status: 401 }
      );
    }

    // Rate limit per API key
    const { allowed, remaining } = checkRateLimit(`apikey:${key}`, 200);

    if (!allowed) {
      return NextResponse.json(
        { data: null, error: "Rate limit exceeded. Upgrade your plan for higher limits." },
        { status: 429, headers: { "X-RateLimit-Remaining": "0" } }
      );
    }

    // Track usage
    trackUsage(key, pathname);

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Limit", "200");
    response.headers.set("X-Request-Duration-Ms", String(Date.now() - startTime));
    return addCorsHeaders(response, request);
  }
  // No keys configured — deny access (not dev mode)
  console.warn('[AUTH] No NEXUS_API_KEYS configured — denying access. Set NEXUS_API_KEYS env var.');
  return NextResponse.json(
    { data: null, error: "API key required. Set NEXUS_API_KEYS env var." },
    { status: 401 }
  );
}

function addCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
