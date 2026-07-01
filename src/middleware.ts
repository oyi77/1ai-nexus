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
  "/api/v1/dex/trending",
  "/api/v1/dex/new-pairs",
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
  "/api/v1/entities/graph",
  "/api/v1/smart-money",
  "/api/v1/smart-money/flows",
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
  "/api/v1/liquidations",
  "/api/v1/insider",
  "/api/v1/whale-alert",
  "/api/v1/mempool",
  "/api/v1/rugcheck",
  "/api/v1/gas",
  "/api/v1/stablecoin-flow",
  "/api/v1/whale-cluster",
  "/api/v1/status/cache",
  "/api/v1/health",
  "/api/v1/top-traders",
  "/api/v1/orderbook",
  "/api/v1/token/holders",
  "/api/v1/token/god-mode",
  "/api/v1/liquidations/heatmap",
  "/api/v1/basis",
  "/api/v1/yields",
  "/api/v1/arbitrage",
  "/api/v1/mev",
  "/api/v1/paper-trades",
  "/api/v1/paper-trading",
  "/api/v1/paper-trades/stats",
  "/api/v1/paper-trades/resolve",
  "/api/v1/alpha-engine",
  "/api/v1/trades",
  "/api/v1/prediction-markets",
  "/api/v1/revenue",
  "/api/v1/sector-flows",
  "/api/v1/trending-coins",
  "/api/v1/calendar",
  "/api/v1/alpha-cross-correlation",
  "/api/v1/modules",
  "/api/v1/modules/fetch",
  "/api/v1/indonesia-macro",
  "/api/v1/trading",
  "/api/v1/compliance",
  "/api/v1/historical",
  "/api/v1/screener",
  "/api/v1/keys",
  "/api/auth",
  "/api/v1/historical-financials",
  "/api/v1/cohorts",
  "/api/v1/derivatives-intel",
  "/api/v1/options-intel",
  "/api/v1/news-intel",
  "/api/v1/unlocks",
  "/api/v1/etf-flows",
  "/api/v1/onchain-intel",
  "/api/v1/risk-intel",
  "/api/v1/composite-alerts",
  "/api/v1/intelligence-score",
  "/api/v1/backtest",
  "/api/v1/bonds",
  "/api/v1/ohlcv",
  "/api/v1/dev-activity",
  "/api/v1/cycle-indicators",
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

  // Public routes — rate limit per IP but don't require API key
  if (PUBLIC_API_ROUTES.has(pathname) || pathname.startsWith("/api/auth/")) {
    const ip = getClientIp(request);
    const { allowed, remaining } = checkRateLimit(`public:${ip}`, 300, 60_000); // 300 req/min per IP
    if (!allowed) {
      return NextResponse.json(
        { data: null, error: "Rate limit exceeded. Slow down." },
        { status: 429, headers: { "X-RateLimit-Remaining": "0", "Retry-After": "60" } }
      );
    }
    const response = addCorsHeaders(NextResponse.next(), request);
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Limit", "300");
    return response;
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
