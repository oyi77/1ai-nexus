// ─────────────────────────────────────────────────────────────
// Module: Birdeye Forge — Meme Alpha (discovery + security audit)
// sourceType: re
// upstreamProduct: Birdeye (birdeye.so) — internal forge API used by the
//   birdeye.so frontend (discovered via browser RE / devtools-network-tab)
// endpoint: https://birdeye.so/forge/solana  (POST /v3/gems, GET /token/*, /overview/*)
// discoveredVia: devtools-network-tab
// lastVerified: 2026-10-07
// UNOFFICIAL: this calls birdeye.so's internal frontend API, not their
//   public-api.birdeye.so (which requires an x-api-key). It may break
//   without notice if they change their dashboard.
//   fallbackFn: none (route-level per-source error isolation handles gaps)
// Auth: NONE. Requires standard User-Agent + Referer headers.
// Transport: curl child (Cloudflare now fingerprints ALL Node TLS stacks —
//   undici fetch, https, AND node:http2 return a 403 challenge since ~2026-10.
//   System curl passes with identical URL/headers/body — verified 2026-10-07).
// Chain: solana only (forge API is Solana-specific).
// ─────────────────────────────────────────────────────────────
import type { MemeAlphaToken, MemeRiskAudit } from '../types'
import { normalizeChainId, normalizeTimestamp } from '../normalize'
import { execFileSync } from 'node:child_process'

const BIRDEYE_BASE = 'https://birdeye.so'
const BIRDEYE_PREFIX = '/forge/solana'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36'
// ── curl-child transport ────────────────────────────────────────
// Cloudflare blocks every Node TLS stack (undici, https, node:http2)
// with a 403 TLS fingerprint challenge. System curl passes with the
// identical URL/headers/body. Mirrors the ajaib rscGet pattern.
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1_048_576

/** Env copy with every *proxy* var removed (case-insensitive). */
function directEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (k.toLowerCase().includes('proxy')) delete env[k]
  }
  return env
}

// Injectable seam for tests (defaults to execFileSync). Keep module-local:
// tests must not fight other suites over a global child_process mock.
// ponytail: sync execFileSync blocks the event loop ~RTT; switch to execFile
// async when Birdeye latency dominates route p95 — error contract unchanged.
let runCurl: (args: string[]) => string = (args) =>
  execFileSync('curl', args, {
    env: directEnv(),
    encoding: 'utf8',
    maxBuffer: MAX_RESPONSE_BYTES + 64,
    timeout: REQUEST_TIMEOUT_MS + 2_000,
  }) as string

export function __setBirdeyeCurlForTests(fn: typeof runCurl | null): void {
  runCurl =
    fn ??
    ((args) =>
      execFileSync('curl', args, {
        env: directEnv(),
        encoding: 'utf8',
        maxBuffer: MAX_RESPONSE_BYTES + 64,
        timeout: REQUEST_TIMEOUT_MS + 2_000,
      }) as string)
}

function curlReq<T>(method: string, path: string, payload?: string): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const url = `${BIRDEYE_BASE}${BIRDEYE_PREFIX}${path}`
  const args = [
    '-sS',
    '-L',
    '--http2',
    '--max-time',
    String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
    '-X',
    method,
    '-H',
    `User-Agent: ${UA}`,
    '-H',
    'Referer: https://birdeye.so/',
    '-H',
    'Accept: application/json',
  ]
  if (payload) {
    args.push('-H', 'Content-Type: application/json', '--data', payload)
  }
  args.push('-w', '\nCURL_STATUS:%{http_code}', url)
  let out: string
  try {
    out = runCurl(args)
  } catch (e) {
    const isRecord = typeof e === 'object' && e !== null
    const code = isRecord && 'code' in e ? String(e.code) : ''
    if (isRecord && (('killed' in e && e.killed === true) || code === 'ETIMEDOUT')) {
      reject(new Error(`Birdeye request timeout: ${path}`))
      return promise
    }
    if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      reject(new Error(`Birdeye response too large: ${path}`))
      return promise
    }
    reject(e instanceof Error ? e : new Error(String(e)))
    return promise
  }
  const m = /\nCURL_STATUS:(\d{3})\s*$/.exec(out)
  const status = m ? Number(m[1]) : 0
  const body = m ? out.slice(0, m.index) : out
  if (status >= 400 || status === 0) {
    reject(new Error(`Birdeye ${status}: ${path}`))
    return promise
  }
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    reject(new Error(`Birdeye response too large: ${path}`))
    return promise
  }
  try {
    resolve(JSON.parse(body))
  } catch {
    reject(new Error(`Birdeye parse error: ${path}`))
  }
  return promise
}

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Raw payload shapes (Birdeye forge) ────────────────────────

interface BirdeyeTimeFrame {
  tradeCount?: number
  tradeCountChangePercent?: number
  volumeUSD?: number
  volumeChangePercent?: number
  uniqueWallets?: number
  priceChangePercent?: number
}

interface BirdeyeGem {
  symbol?: string
  address?: string
  name?: string
  network?: string
  liquidity?: number
  price?: number
  mc?: number
  fdmc?: number
  supply?: number
  circulatingSupply?: number
  holderCount?: number
  top10HolderPercent?: number
  createdAt?: number
  rank?: number
  birdeyeStrict?: boolean
  jupStrict?: boolean
  extensions?: { twitter?: string; website?: string; telegram?: string; discord?: string }
  tf1h?: BirdeyeTimeFrame
  tf4h?: BirdeyeTimeFrame
  tf24h?: BirdeyeTimeFrame
}

interface BirdeyeGemsResponse {
  data?: { items?: BirdeyeGem[] }
  success?: boolean
}

interface BirdeyeSecurityRow {
  id?: string
  severity?: number
  name?: string
  type?: string
  tooltip?: string
}

interface BirdeyeSecurityDetails {
  data?: { groups?: { name?: string; rows?: BirdeyeSecurityRow[] }[] }
  success?: boolean
}

interface BirdeyeAuditGroup {
  balance?: number
  wallets?: number
  percentage?: number
}

interface BirdeyeAudit {
  data?: {
    smart_money?: BirdeyeAuditGroup
    dev?: BirdeyeAuditGroup
    top10Holders?: BirdeyeAuditGroup
    snipper?: BirdeyeAuditGroup
    bundler?: BirdeyeAuditGroup
    insider?: BirdeyeAuditGroup
  }
  success?: boolean
}

// ── Normalizers ───────────────────────────────────────────────

function deriveDiscoveryRisk(g: BirdeyeGem): number {
  let risk = 0
  const top10 = toNum(g.top10HolderPercent)
  if (top10 > 0.5) risk = Math.max(risk, 2)
  else if (top10 > 0.3) risk = Math.max(risk, 1)
  if (g.jupStrict === false && g.birdeyeStrict === false) risk = Math.max(risk, 1)
  return Math.min(3, risk)
}

// ── Discovery ─────────────────────────────────────────────────

/** New-token discovery: Solana gems (trending / gainers / volume). */
export async function discoverBirdeyeTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const body = JSON.stringify({
    type: 'trending',
    sort_by: 'rank',
    sort_type: 'asc',
    offset: 0,
    limit: Math.min(limitPerChain, 50),
    shown_time_frame: '24h',
  })

  const res = await curlReq<BirdeyeGemsResponse>('POST', '/v3/gems', body)
  const items = res.data?.items ?? []
  const out: MemeAlphaToken[] = []
  const seen = new Set<string>()
  for (const g of items) {
    const contract = g.address ?? ''
    if (!contract || seen.has(contract)) continue
    seen.add(contract)
    const chain = normalizeChainId(g.network ?? 'solana')
    const tf = g.tf24h ?? {}
    const e = g.extensions ?? {}
    const social: MemeAlphaToken['social'] = {}
    if (e.twitter) social.twitter = e.twitter
    if (e.telegram) social.telegram = e.telegram
    if (e.website) social.site = e.website
    out.push({
      id: `${chain}:${contract}`,
      platform: 'birdeye',
      chain,
      contract,
      symbol: g.symbol ?? '',
      name: g.name ?? '',
      price: toNum(g.price),
      change24h: toNum(tf.priceChangePercent) / 100,
      volume24h: toNum(tf.volumeUSD),
      marketCap: toNum(g.mc),
      liquidity: toNum(g.liquidity),
      createdAt: typeof g.createdAt === 'number' ? normalizeTimestamp(g.createdAt) : null,
      riskLevel: deriveDiscoveryRisk(g),
      holders: toNum(g.holderCount),
      top10HolderPercent: toNum(g.top10HolderPercent),
      social,
      audited: !!g.birdeyeStrict,
      provenance: {
        sourceType: 'reverse-engineered',
        provider: 'birdeye',
        experimental: true,
        note: 'Forge API RE-ed from birdeye.so frontend; not public-api.birdeye.so',
      },
      // Discovery heuristic (holder concentration + strict flags), not an audit.
      riskKnown: false,
    })
  }
  return out
}

// ── Risk audit ────────────────────────────────────────────────

function severityToCounts(groups: NonNullable<BirdeyeSecurityDetails['data']>['groups']): {
  riskLevel: number
  riskCounts: { high: number; middle: number; low: number }
  canFreeze: boolean
  canMint: boolean
} {
  let high = 0, middle = 0, low = 0
  let canFreeze = false, canMint = false
  for (const g of groups ?? []) {
    for (const row of g.rows ?? []) {
      const id = (row.id ?? '').toLowerCase()
      if (id.includes('freeze')) canFreeze = true
      if (id.includes('mint')) canMint = true
      const sev = toNum(row.severity)
      if (sev >= 4) high++
      else if (sev === 3) middle++
      else if (sev >= 1) low++
    }
  }
  const riskLevel = high > 0 ? 3 : middle > 0 ? 2 : low > 0 ? 1 : 0
  return { riskLevel, riskCounts: { high, middle, low }, canFreeze, canMint }
}

export async function auditBirdeyeToken(chain: string, contract: string): Promise<MemeRiskAudit | null> {
  try {
    const security = await curlReq<BirdeyeSecurityDetails>(
      'GET',
      `/token/security_details?token=${encodeURIComponent(contract)}&group_by=severity`,
    )
    const sev = severityToCounts(security.data?.groups)

    let top10HolderPercent = 0
    try {
      const audit = await curlReq<BirdeyeAudit>(
        'GET', `/overview/audit?address=${encodeURIComponent(contract)}`,
      )
      const pct = toNum(audit.data?.top10Holders?.percentage)
      // Birdeye percentage scale is inconsistent: 0..1 fraction for some
      // tokens, 0..100 percent for others. Normalize to a 0..1 fraction.
      top10HolderPercent = pct > 1 ? pct / 100 : pct
    } catch { /* audit optional */ }

    const riskLabel = (['safe', 'low', 'middle', 'high'][sev.riskLevel] || 'unknown') as MemeRiskAudit['riskLabel']
    return {
      id: `${chain}:${contract}`,
      platform: 'birdeye',
      chain: chain || 'solana',
      contract,
      symbol: '',
      name: '',
      riskLevel: sev.riskLevel,
      riskLabel,
      buyTax: 0,
      sellTax: 0,
      top10HolderPercent,
      lpLockedPercent: -1,
      canFreeze: sev.canFreeze,
      canMint: sev.canMint,
      isHoneypot: false, // not reported by this source
      riskCounts: sev.riskCounts,
      auditedAt: Date.now(),
    }
  } catch {
    return null
  }
}

// ── Enrichment ────────────────────────────────────────────────

export async function getBirdeyeTotalHolders(contract: string): Promise<number> {
  try {
    const res = await curlReq<{ data?: { total?: number }; success?: boolean }>(
      'GET', `/token/total_holder?address=${encodeURIComponent(contract)}`,
    )
    return toNum(res.data?.total)
  } catch {
    return 0
  }
}

export async function getBirdeyeTokenOverview(contract: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await curlReq<{ data?: Record<string, unknown>; success?: boolean }>(
      'GET', `/overview/token?address=${encodeURIComponent(contract)}`,
    )
    return res.data ?? null
  } catch {
    return null
  }
}