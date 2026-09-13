import { NextResponse, type NextRequest } from 'next/server'
import { trackUsage } from '@/lib/usage-tracking'
import { extractJwtSession, checkSubscriptionRateLimit } from '@/lib/jwt-middleware'

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4400',
  'https://tracker.aitradepulse.com',
]

// ─────────────────────────────────────────────────────────────
// Route classification
//
// PUBLIC  — market data readable by anyone, including third-party origins
//           (the embeddable widget fetches it cross-origin without a
//           credential). Rate limited per IP.
// PROTECTED — per-user data, billing, and premium derived signals. Always
//           require a JWT session (browser) or API key (external).
//
// Any route in neither set is readable by a first-party browser and requires
// an API key from third parties.
//
// PROTECTED is evaluated FIRST so an explicit denial can never be shadowed by
// a broader public prefix.
// ─────────────────────────────────────────────────────────────

/** Public routes matched exactly. */
const PUBLIC_ROUTES = new Set([
  '/api/v1/health',
  '/api/v1/health/detailed',

  // ── Platform ──
  '/api/v1/status',
  '/api/v1/status/cache',
  '/api/v1/modules',

  // ── Auth (also covered by the /api/v1/auth/ prefix below) ──
  '/api/v1/auth',

  // ── Market data ──
  '/api/v1/market/prices',
  '/api/v1/market/flow',
  '/api/v1/market/sentiment',
  '/api/v1/market-score',
  '/api/v1/market-ticks',
  '/api/v1/ohlcv',
  '/api/v1/orderbook',
  '/api/v1/screener',
  '/api/v1/trades',
  '/api/v1/signals',
  '/api/v1/signals/stats',
  '/api/v1/signals/outcomes',
  '/api/v1/signal-confidence',
  '/api/v1/trending',
  '/api/v1/trending-coins',
  '/api/v1/crypto/top-symbols',
  '/api/v1/correlations',
  '/api/v1/liquidations',
  '/api/v1/liquidations/heatmap',
  '/api/v1/arbitrage',
  '/api/v1/arbitrage/crossex',
  '/api/v1/basis',
  '/api/v1/derivatives',
  '/api/v1/derivatives-intel',
  '/api/v1/options-intel',
  '/api/v1/exchanges',
  '/api/v1/exchange-flow',
  '/api/v1/hyperliquid',
  '/api/v1/position-size',
  '/api/v1/gaps',
  '/api/v1/edge-report',
  '/api/v1/intelligence-score',
  '/api/v1/attention-index',
  '/api/v1/paper-trading',

  // ── On-chain ──
  '/api/v1/entities',
  '/api/v1/entities/graph',
  '/api/v1/smart-money',
  '/api/v1/smart-money/flow',
  '/api/v1/smart-money/flows',
  '/api/v1/smart-money/wallet',
  '/api/v1/whale-alert',
  '/api/v1/whale-cluster',
  '/api/v1/top-traders',
  '/api/v1/flows',
  '/api/v1/sector-flows',
  '/api/v1/stablecoin-flow',
  '/api/v1/stablecoin-intel',
  '/api/v1/mempool',
  '/api/v1/mev',
  '/api/v1/gas',
  '/api/v1/insider',
  '/api/v1/rugcheck',
  '/api/v1/tokens',
  '/api/v1/tokens/discover',
  '/api/v1/token/god-mode',
  '/api/v1/token/holders',
  '/api/v1/token/thesis',
  '/api/v1/cohorts',
  '/api/v1/risk-intel',
  '/api/v1/risk/drawdown',
  '/api/v1/infra-signals',
  '/api/v1/cycle-indicators',
  '/api/v1/dev-activity',
  '/api/v1/onchain-intel',
  '/api/v1/macro-onchain',
  '/api/v1/thegraph',
  '/api/v1/tokenterminal',
  '/api/v1/vimero',
  '/api/v1/feeds',
  '/api/v1/feed',
  '/api/v1/history',
  '/api/v1/historical',

  // ── DeFi ──
  '/api/v1/defi',
  '/api/v1/defi/overview',
  '/api/v1/defi/tvl',
  '/api/v1/defi/yields',
  '/api/v1/defillama',
  '/api/v1/yields',
  '/api/v1/revenue',
  '/api/v1/protocol-revenue',
  '/api/v1/stablecoins',
  '/api/v1/sectors',
  '/api/v1/unlocks',
  '/api/v1/dex/trending',
  '/api/v1/dex/new-pairs',
  '/api/v1/dex/boosted',
  '/api/v1/meme/leaderboard',
  '/api/v1/meme/risk',
  '/api/v1/copy-trade',
  '/api/v1/copy-trading/leaderboard',
  '/api/v1/copy-trading/performance',
  '/api/v1/copy-trading/leader',

  // ── Macro / news / TradFi ──
  '/api/v1/macro',
  '/api/v1/global-macro',
  '/api/v1/indonesia-macro',
  '/api/v1/calendar',
  '/api/v1/news',
  '/api/v1/news-intel',
  '/api/v1/sentiment',
  '/api/v1/fear-greed',
  '/api/v1/forex',
  '/api/v1/equities',
  '/api/v1/equities/universe',
  '/api/v1/commodities',
  '/api/v1/bonds',
  '/api/v1/etf-flows',
  '/api/v1/financials',
  '/api/v1/historical-financials',
  '/api/v1/tradfi',
  '/api/v1/predictions',
  '/api/v1/prediction-markets',
  '/api/v1/arkham',
  '/api/v1/alt-data',
  '/api/v1/weather-signals',
  '/api/v1/composite-alerts',
  '/api/v1/alpha-feed',
  '/api/v1/alpha-cross-correlation',
  '/api/v1/conviction',
  '/api/v1/conviction/accuracy',
  '/api/v1/conviction/stream',

  // ── IDX ──
  '/api/v1/saham/screener',
  '/api/v1/saham/bandarmology',
  '/api/v1/saham/track-record',
  '/api/v1/saham/watchlist-ideas',
  '/api/v1/saham/fundamentals',
  '/api/v1/saham/realtime',

  // ── Telemetry / webhooks (self-authenticating via secret or CORS) ──
  '/api/v1/analytics',
  '/api/v1/analytics/pageview',
  '/api/v1/leads',
  '/api/v1/telegram',
  '/api/v1/telegram/alert',
  '/api/v1/telegram/personal-alerts',
  '/api/v1/webhooks/payment',
])

/** Public routes with dynamic segments — matched by prefix. */
const PUBLIC_PREFIXES = ['/api/v1/token/', '/api/v1/wallets/']

/**
 * Routes that always require a session or API key.
 * Exact entries first, then prefixes for nested/dynamic paths.
 */
const PROTECTED_ROUTES = new Set([
  '/api/v1/admin/stats',
  '/api/v1/admin/users',
  '/api/v1/checkout',
  '/api/v1/keys',
  '/api/v1/signals/history',
  '/api/v1/usage',
  '/api/v1/telegram/broadcast',
  '/api/v1/telegram/subscribe',
  '/api/v1/user/api-key',
  '/api/v1/watchlist',
  // Premium derived signals
  '/api/v1/alpha-engine',
  '/api/v1/backtest',
  '/api/v1/launch-alpha',
  '/api/v1/lead-lag',
  '/api/v1/lrfg',
  '/api/v1/opportunities',
  '/api/v1/sfc',
])

const PROTECTED_PREFIXES = [
  '/api/v1/account/',
  '/api/v1/ai/',
  '/api/v1/alerts',
  '/api/v1/cron/',
  '/api/v1/follows',
  // Gated as a whole; isPublicModuleFetch() opens specific modules.
  '/api/v1/modules/fetch',
  '/api/v1/paper-trades',
  '/api/v1/payments/',
  '/api/v1/webhooks/',
]

/**
 * Data modules a first-party page fetches straight from the browser. The
 * module executor at /api/v1/modules/fetch is otherwise gated because it can
 * reach any registered module, so anonymous access is granted per module
 * rather than by un-gating the endpoint. Only add read-only upstreams here.
 */
const PUBLIC_MODULE_IDS = new Set([
  'coingecko',
  'defillama',
  'deribit-options',
  'yahoo-finance',
])

/**
 * True when the request is a module fetch for an allowlisted module, which is
 * the only way /api/v1/modules/fetch is reachable without a credential.
 */
function isPublicModuleFetch(request: NextRequest): boolean {
  if (request.nextUrl.pathname !== '/api/v1/modules/fetch') return false
  const moduleId = request.nextUrl.searchParams.get('module')
  return moduleId !== null && PUBLIC_MODULE_IDS.has(moduleId)
}

function isProtected(pathname: string): boolean {
  if (PROTECTED_ROUTES.has(pathname)) return true
  return PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p))
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/v1/auth/')) return true
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

// Parse API keys from env
const API_KEYS = new Set(
  process.env.NEXUS_API_KEYS?.split(',').map(k => k.trim()).filter(Boolean) ?? []
)

// ─── Rate Limiting (in-memory, per-edge instance) ──────────

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitMap = new Map<string, RateLimitEntry>()

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown'
}

function checkRateLimit(key: string, maxRequests = 100, windowMs = 60_000): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1 }
  }

  entry.count++
  const remaining = Math.max(0, maxRequests - entry.count)
  return { allowed: entry.count <= maxRequests, remaining }
}

/**
 * True when the request provably originates from our own browser client.
 *
 * `Sec-Fetch-Site` is on the forbidden header list — page script cannot set or
 * forge it — so `same-origin` is trustworthy. Older engines omit it, so we fall
 * back to comparing Origin/Referer against the allowlist.
 */
function isSameOriginBrowser(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'

  const origin = request.headers.get('origin')
  if (origin) return ALLOWED_ORIGINS.includes(origin)

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return ALLOWED_ORIGINS.includes(new URL(referer).origin)
    } catch {
      return false
    }
  }
  return false
}

// ─── Usage Tracking (in-memory, per-edge instance) ─────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const startTime = Date.now()

  // Only apply to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // CORS preflight must succeed before any auth check, otherwise browsers
  // report the failure as an opaque network error.
  if (request.method === 'OPTIONS') {
    return addCorsHeaders(new NextResponse(null, { status: 204 }), request)
  }

  // Legacy routes (used by frontend) — rate limit + deprecation warning
  if (!pathname.startsWith('/api/v1/')) {
    const ip = getClientIp(request)
    const { allowed, remaining } = checkRateLimit(`legacy:${ip}`, 600)
    if (!allowed) {
      return NextResponse.json(
        { data: null, error: 'Rate limit exceeded' },
        { status: 429, headers: { 'X-RateLimit-Remaining': '0' } }
      )
    }
    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    response.headers.set('X-RateLimit-Limit', '600')
    response.headers.set('Deprecation', 'true')
    return addCorsHeaders(response, request)
  }

  // ── Protected first: an explicit denial is never shadowed by a public prefix ──
  // Allowlisted data modules are the one exception, so the public market pages
  // can read their data from a browser without a credential.
  if (isProtected(pathname) && !isPublicModuleFetch(request)) {
    const session = extractJwtSession(request)
    const authHeader = request.headers.get('authorization')
    const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const hasApiKey = !!apiKey && API_KEYS.size > 0 && API_KEYS.has(apiKey)

    if (!session && !hasApiKey) {
      return NextResponse.json(
        { data: null, error: 'Authentication required for this premium feature' },
        { status: 401 }
      )
    }
    if (session) {
      const limit = checkSubscriptionRateLimit(session.userId, session.plan)
      if (!limit.allowed) {
        return NextResponse.json(
          { data: null, error: 'Rate limit reached for plan ' + session.plan },
          { status: 429, headers: { 'X-RateLimit-Remaining': '0' } }
        )
      }
      const response = NextResponse.next()
      response.headers.set('X-RateLimit-Remaining', String(limit.remaining))
      response.headers.set('X-RateLimit-Limit', String(limit.limit))
      return addCorsHeaders(response, request)
    }
    // API-key consumers fall through to the standard API-key rate-limit below
  }

  // ── Public market data ──
  // PUBLIC_ROUTES are readable by anyone, including third-party origins: the
  // embeddable widget (public/nexus-widget.js) fetches them cross-origin with
  // no credential. Allowlisted data modules are treated the same because they
  // are read-only market data. Any other route is readable by a first-party
  // browser so the app's own UI keeps working without an allowlist edit per
  // new endpoint; third parties fall through to the API-key gate below.
  if (isPublic(pathname) || isSameOriginBrowser(request) || isPublicModuleFetch(request)) {
    const key = request.headers.get('authorization')?.startsWith('Bearer ')
      ? request.headers.get('authorization')!.slice(7)
      : null
    const isKnownKey = !!key && API_KEYS.has(key)
    const { allowed, remaining } = checkRateLimit(`public:${key ?? getClientIp(request)}`, 600)

    if (!allowed) {
      return NextResponse.json(
        { data: null, error: 'Rate limit exceeded. Upgrade your plan for higher limits.' },
        { status: 429, headers: { 'X-RateLimit-Remaining': '0' } }
      )
    }
    if (isKnownKey) trackUsage(key!, pathname)

    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    response.headers.set('X-RateLimit-Limit', '600')
    response.headers.set('X-Request-Duration-Ms', String(Date.now() - startTime))
    return addCorsHeaders(response, request)
  }

  // ── Everything else: external API consumer, require a valid key ──
  if (API_KEYS.size > 0) {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { data: null, error: 'Missing authentication. Use x-csrf-token header (browser) or Authorization: Bearer <key> (API)' },
        { status: 401 }
      )
    }
    const key = authHeader.slice(7)
    if (!API_KEYS.has(key)) {
      return NextResponse.json(
        { data: null, error: 'Invalid API key' },
        { status: 401 }
      )
    }

    const { allowed, remaining } = checkRateLimit(`apikey:${key}`, 200)
    if (!allowed) {
      return NextResponse.json(
        { data: null, error: 'Rate limit exceeded. Upgrade your plan for higher limits.' },
        { status: 429, headers: { 'X-RateLimit-Remaining': '0' } }
      )
    }

    trackUsage(key, pathname)

    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    response.headers.set('X-RateLimit-Limit', '200')
    response.headers.set('X-Request-Duration-Ms', String(Date.now() - startTime))
    return addCorsHeaders(response, request)
  }

  // No keys configured — deny access (not dev mode)
  console.warn('[AUTH] No NEXUS_API_KEYS configured — denying access. Set NEXUS_API_KEYS env var.')
  return NextResponse.json(
    { data: null, error: 'API key required. Set NEXUS_API_KEYS env var.' },
    { status: 401 }
  )
}

function addCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const origin = request.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token')
  return response
}

export const config = {
  matcher: '/api/:path*',
}
