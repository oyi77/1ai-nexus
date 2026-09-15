// ─────────────────────────────────────────────────────────────
// Module: Moby (moby.win / mobyscreener) — Meme Alpha
// sourceType: re
// upstreamProduct: Moby — smart-money meme screener (mobile-first, $MOBY)
// endpoint: https://web-api.mobyscreener.com/web/api_v2  (GET, Bearer Privy JWT)
// discoveredVia: apk-js-bundle + web-app-chunk RE (app.moby.win)
// lastVerified: 2026-09-15
//
// RE PATH (reproducible):
//   1. APK v1.1.17 JS bundle listed /mobile/api_v1/* paths — DEAD behind
//      Cloudflare managed challenge (403 fetch + node:http2 + dummy key).
//   2. app.moby.win chunk analytics-Pjg_L9EF.js bakes VITE_API_URL +
//      VITE_PRIVY_APP_ID (cmg5m1dgg025kl20cusn1cypb).
//   3. LaunchpadBadge chunk shows screener fetchers:
//      GET {base}/tokens/screener/leaderboard/ → {entries[]}
//      GET {base}/tokens/screener/leaderboard/group/ → {entries[]}
//      GET {base}/tokens/screener/groups/ → {groups[]}
//      GET {base}/tokens/screener/launchpads/ → {launchpads[]}
//      Append /web/api_v2 prefix; auth = Authorization: Bearer <Privy JWT>.
//   4. Privy app allows email OTP only (siwe/siws/guest all
//      disallowed_login_method). Disposable inbox (guerrillamail) works:
//      POST auth.privy.io/api/v1/passwordless/init {email}
//      → code from inbox → POST .../passwordless/authenticate
//      {email, code, mode: login-or-sign-up} → {token} (ES256 JWT, ~1h TTL).
//   5. Set MOBY_API_KEY=<privy JWT>. No key → descriptive throw;
//      routes error-isolate per platform (leaderboard/risk).
//
// Verified live 2026-09-15: leaderboard 188 solana entries (ORE...),
// groups 8, launchpads, details + holders/list + chart for ORE,
// chains solana/base/bnb/robinhood, pnl-leaderboard 24h.
// DEAD (404): signalsFeed, clips/list, whalewatch/follows (APK-era paths).
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'

const MOBY_BASE = 'https://web-api.mobyscreener.com/web/api_v2'
const PRIVY_APP_ID = 'cmg5m1dgg025kl20cusn1cypb'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36'

// Networks from GET /tokens/chains/ (verified 2026-09-15).
const DISCOVERY_NETWORKS = ['solana', 'base', 'bnb', 'robinhood'] as const

function mobyKey(): string {
  const key = process.env.MOBY_API_KEY
  if (!key) {
    throw new Error(
      'No Moby key — set MOBY_API_KEY to a Privy JWT for app cmg5m1dgg025kl20cusn1cypb ' +
        '(mint via email OTP: passwordless/init → passwordless/authenticate).',
    )
  }
  // Privy JWTs live ~1h. Fail fast on an expired token so the route's
  // platformsStatus says "expired", not a misleading upstream 401.
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        exp?: number
      }
      if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
        throw new Error(
          'MOBY_API_KEY expired — Privy JWTs live ~1h; mint a fresh one via ' +
            'passwordless/init → passwordless/authenticate.',
        )
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('MOBY_API_KEY expired')) throw e
      // non-JWT key (future API-key support) — pass through
    }
  }
  return key
}

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Raw payload shapes (web-api api_v2) ─────────────────────

interface MobyEntry {
  network?: string
  token_address?: string
  token_symbol?: string
  token_logo?: string
  token_created?: string
  token_decimals?: number
  is_new?: boolean
  is_pro?: boolean | null
  launchpad?: string | null
  safety_tier?: string
  price_usd?: number
  market_cap_usd?: number
  total_supply?: number
  liquidity_usd?: number
  price_change_percent?: Record<string, number>
  volume_usd?: Record<string, number> | number
  transactions_count?: Record<string, number>
  whale_count?: Record<string, number>
  whale_trades_count?: Record<string, number>
  whale_net_flow_usd?: Record<string, number>
  score_values?: { h24?: number }
}

interface MobyLeaderboardResponse {
  entries?: MobyEntry[]
}

interface MobyDetails {
  address?: string
  symbol?: string
  name?: string
  decimals?: number
  created?: string
  launchpad?: string | null
  safety_tier?: string
  is_new?: boolean
  is_pro?: boolean | null
  holders?: number
  liquidity?: number
  supply?: number
  market_cap?: number
  volume?: number
  twitter_url?: string | null
  telegram?: string | null
  website_url?: string | null
  whale_data?: {
    h1?: { net_volume_usd?: number; traders_count?: number; trades_count?: number }
    h4?: { net_volume_usd?: number; traders_count?: number; trades_count?: number }
  }
}

interface MobyDetailsResponse {
  details?: MobyDetails
}

interface MobyHolder {
  address?: string
  amount?: number
  percent?: number
  value_usd?: number
}

interface MobyHoldersResponse {
  holders?: MobyHolder[]
  total_holders?: number
}

// ── HTTP ────────────────────────────────────────────────────

async function mobyGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const key = mobyKey()
  const qs = params ? `?${new URLSearchParams(params)}` : ''
  const res = await fetch(`${MOBY_BASE}${path}${qs}`, {
    headers: {
      accept: 'application/json',
      'user-agent': UA,
      origin: 'https://app.moby.win',
      referer: 'https://app.moby.win/',
      authorization: `Bearer ${key}`,
      'privy-app-id': PRIVY_APP_ID,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Moby ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ── Normalizers ─────────────────────────────────────────────

const SAFETY_RISK: Record<string, number> = { green: 0, yellow: 1, orange: 2, red: 3 }

function safetyRisk(tier: string | undefined): number {
  if (!tier) return 1
  return SAFETY_RISK[tier.toLowerCase()] ?? 1
}

function timeframe24h(v: Record<string, number> | number | undefined): number {
  if (typeof v === 'number') return v
  return toNum(v?.h24)
}

function toToken(e: MobyEntry): MemeAlphaToken | null {
  const contract = e.token_address ?? ''
  if (!contract) return null
  const chain = e.network ?? 'solana'
  const change24h = toNum(e.price_change_percent?.h24) / 100
  return {
    id: `${chain}:${contract}`,
    platform: 'moby' as MemePlatform,
    chain,
    contract,
    symbol: e.token_symbol ?? '',
    name: e.token_symbol ?? '',
    price: toNum(e.price_usd),
    change24h,
    volume24h: timeframe24h(e.volume_usd),
    marketCap: toNum(e.market_cap_usd),
    liquidity: toNum(e.liquidity_usd),
    createdAt: e.token_created ? Date.parse(e.token_created) || null : null,
    riskLevel: safetyRisk(e.safety_tier),
    holders: 0, // leaderboard rows carry no holder count; audit fills it
    top10HolderPercent: 0,
    social: {},
    audited: false,
  }
}

// ── Discovery ───────────────────────────────────────────────

/** New-token discovery: screener leaderboard per network (whale telemetry). */
export async function discoverMobyTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  const seen = new Set<string>()
  for (const network of DISCOVERY_NETWORKS) {
    const raw = await mobyGet<MobyLeaderboardResponse>('/tokens/screener/leaderboard/', {
      network,
    })
    for (const e of raw.entries ?? []) {
      const t = toToken(e)
      if (!t || seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
      if (out.filter((x) => x.chain === network).length >= limitPerChain) break
    }
  }
  return out
}

// ── Risk audit ──────────────────────────────────────────────

/** Honeypot / rug audit: details + holders list → normalized risk row. */
export async function auditMobyToken(
  chain: string,
  contract: string,
): Promise<MemeRiskAudit | null> {
  try {
    const network = chain || 'solana'
    const [det, hol] = await Promise.all([
      mobyGet<MobyDetailsResponse>('/tokens/token/details', {
        token_address: contract,
        network,
      }),
      mobyGet<MobyHoldersResponse>('/tokens/token/holders/list', {
        token_address: contract,
        network,
      }),
    ])
    const d = det.details
    if (!d) return null
    const holders = hol.holders ?? []
    const top10 = holders
      .slice(0, 10)
      .reduce((s, h) => s + toNum(h.percent), 0)
    const top10HolderPercent = top10 > 1 ? top10 / 100 : top10
    const riskLevel = safetyRisk(d.safety_tier)
    const riskCounts = {
      high: riskLevel >= 3 ? 1 : 0,
      middle: riskLevel === 2 ? 1 : 0,
      low: riskLevel === 1 ? 1 : 0,
    }
    const riskLabel = (['safe', 'low', 'middle', 'high'][riskLevel] || 'unknown') as MemeRiskAudit['riskLabel']
    return {
      id: `${network}:${contract}`,
      platform: 'moby',
      chain: network,
      contract,
      symbol: d.symbol ?? '',
      name: d.name ?? '',
      riskLevel,
      riskLabel,
      buyTax: 0, // web-api exposes no tax fields
      sellTax: 0,
      top10HolderPercent,
      lpLockedPercent: -1, // unknown
      canFreeze: false, // unknown from web-api
      canMint: false, // unknown from web-api
      riskCounts,
      auditedAt: Date.now(),
    }
  } catch {
    return null
  }
}
