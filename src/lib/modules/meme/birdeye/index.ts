// ─────────────────────────────────────────────────────────────
// Module: Birdeye Forge — Meme Alpha (discovery + security audit)
// sourceType: re
// upstreamProduct: Birdeye (birdeye.so) — internal forge API used by the
//   birdeye.so frontend (discovered via browser RE / devtools-network-tab)
// endpoint: https://birdeye.so/forge/solana  (POST /v3/gems, GET /token/*, /overview/*)
// discoveredVia: devtools-network-tab
// lastVerified: 2026-08-30
// UNOFFICIAL: this calls birdeye.so's internal frontend API, not their
//   public-api.birdeye.so (which requires an x-api-key). It may break
//   without notice if they change their dashboard.
//   fallbackFn: none (route-level per-source error isolation handles gaps)
// Auth: NONE. Requires standard User-Agent + Referer headers.
// Transport: node:http2 (Cloudflare blocks Node.js fetch/undici with TLS
//   fingerprint 403, but Node http2 client passes — verified 7 endpoints).
// Chain: solana only (forge API is Solana-specific).
// ─────────────────────────────────────────────────────────────

import { TTL } from '../../types'
import type { MemeAlphaToken, MemeRiskAudit } from '../types'
import { connect } from 'node:http2'

const BIRDEYE_BASE = 'https://birdeye.so'
const BIRDEYE_PREFIX = '/forge/solana'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36'

// ── HTTP/2 transport ──────────────────────────────────────────
// Cloudflare blocks Node.js fetch (undici) and native https.request
// with a 403 TLS fingerprint challenge. Node's http2 client passes.

function h2<T>(method: string, path: string, payload?: string): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const client = connect(BIRDEYE_BASE, { timeout: 10_000 })
  client.on('error', reject)
  client.on('connect', () => {
    const headers: Record<string, string> = {
      ':method': method,
      ':path': `${BIRDEYE_PREFIX}${path}`,
      'user-agent': UA,
      referer: 'https://birdeye.so/',
      accept: 'application/json',
    }
    if (payload) headers['content-type'] = 'application/json'
    const req = client.request(headers)
    let data = ''
    req.on('response', (h) => {
      req.on('data', (c) => (data += c))
      req.on('end', () => {
        client.close()
        const status = h[':status']
        if (status && status >= 400) reject(new Error(`Birdeye ${status}: ${path}`))
        else {
          try { resolve(JSON.parse(data) as T) } catch { reject(new Error(`Birdeye parse error: ${path}`)) }
        }
      })
    })
    req.on('error', (e) => { client.close(); reject(e) })
    if (payload) req.end(payload)
    else req.end()
  })
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

  const res = await h2<BirdeyeGemsResponse>('POST', '/v3/gems', body)
  const items = res.data?.items ?? []
  const out: MemeAlphaToken[] = []
  const seen = new Set<string>()
  for (const g of items) {
    const contract = g.address ?? ''
    if (!contract || seen.has(contract)) continue
    seen.add(contract)
    const chain = g.network ?? 'solana'
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
      createdAt: typeof g.createdAt === 'number' ? g.createdAt : null,
      riskLevel: deriveDiscoveryRisk(g),
      holders: toNum(g.holderCount),
      top10HolderPercent: toNum(g.top10HolderPercent),
      social,
      audited: !!g.birdeyeStrict,
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
    const security = await h2<BirdeyeSecurityDetails>(
      'GET',
      `/token/security_details?token=${encodeURIComponent(contract)}&group_by=severity`,
    )
    const sev = severityToCounts(security.data?.groups)

    let top10HolderPercent = 0
    try {
      const audit = await h2<BirdeyeAudit>(
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
    const res = await h2<{ data?: { total?: number }; success?: boolean }>(
      'GET', `/token/total_holder?address=${encodeURIComponent(contract)}`,
    )
    return toNum(res.data?.total)
  } catch {
    return 0
  }
}

export async function getBirdeyeTokenOverview(contract: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await h2<{ data?: Record<string, unknown>; success?: boolean }>(
      'GET', `/overview/token?address=${encodeURIComponent(contract)}`,
    )
    return res.data ?? null
  } catch {
    return null
  }
}