import { NextResponse, type NextRequest } from "next/server";
 import { trackUsage } from "@/lib/usage-tracking";
 const ALLOWED_ORIGINS = [
   "http://localhost:3000",
   "http://localhost:4400",
   "https://tracker.aitradepulse.com",
 ];
 
 // Routes that are always public (health checks, auth, public data APIs)
 const ALWAYS_PUBLIC = new Set([
   "/api/v1/health",
   "/api/v1/status",
   "/api/v1/status/cache",
   "/api/v1/auth",
   "/api/v1/signals/outcomes",
   "/api/v1/signals/summary",
   "/api/v1/signals/current",
   "/api/v1/signals/latest",
   "/api/v1/data/economic",
   "/api/v1/data/forex",
   "/api/v1/data/crypto",
   "/api/v1/data/stocks",
   "/api/v1/data/combined",
   "/api/v1/data/alpha",
   "/api/v1/analysis/metrics",
   "/api/v1/whale-alert",
   "/api/v1/entities",
   "/api/v1/social-volume",
   "/api/v1/fear-greed",
   "/api/v1/market-cap",
   "/api/v1/on-chain",
   "/api/v1/dex/trending",
   "/api/v1/dex/trades",
   "/api/v1/correlation",
   "/api/v1/volume-profile",
   "/api/v1/volatility",
  '/api/v1/derivatives',
  '/api/v1/market/prices',
  '/api/v1/entities/graph',
  '/api/v1/smart-money',
  '/api/v1/dex/new-pairs',
  '/api/v1/macro',
  '/api/v1/news',
  '/api/v1/calendar',
  '/api/v1/yields',
  '/api/v1/revenue',
  '/api/v1/token/god-mode',
  '/api/v1/mempool',
 ]);

// Routes that require JWT authentication (premium features)
const PROTECTED_ROUTES = new Set([
  "/api/v1/signals/history",
  "/api/v1/backtest",
  "/api/v1/alpha-engine",
]);
 
 // Parse API keys from env
 const API_KEYS = new Set(
   process.env.NEXUS_API_KEYS?.split(",").map(k => k.trim()) ?? []
 );

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

 export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const startTime = Date.now();

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
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

  // Always public routes
  if (ALWAYS_PUBLIC.has(pathname) || pathname.startsWith("/api/auth/")) {
    return addCorsHeaders(NextResponse.next(), request);
  }


  
  // Check for browser CSRF token or API key for non-protected routes
  const csrfToken = request.headers.get("x-csrf-token");
  
  // Browser requests with valid CSRF token
  if (csrfToken) {
    const sessionCookie = request.cookies.get("nexus-session");
    if (sessionCookie) {
      // CSRF token exists + session cookie exists → allow browser request
      return addCorsHeaders(NextResponse.next(), request);
    }
  }
  
  // External API requests — require API key
  if (API_KEYS.size > 0) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { data: null, error: "Missing authentication. Use x-csrf-token header (browser) or Authorization: Bearer <key> (API)" },
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
