// BotX (dbotx) meme-alpha / new-token + honeypot-risk discovery.
//
// Endpoints (verified via https://docs.dbotx.com/reference/pair-info*):
//   discovery: GET https://api-data-v1.dbotx.com/kline/new
//               ?chain=solana|bsc&sortBy=pairPriceCreatedAt&sort=-1&interval=1h
//   audit:     GET https://api-data-v1.dbotx.com/kline/pair_info
//               ?chain=solana|bsc&pair=<PAIR_ADDRESS>&type=basic|safety
//   header:    x-api-key: <key>
//
// IMPORTANT: the audit endpoint requires `pair` = the TRADING PAIR contract
// address (the discovery `res[].id` field), NOT the token address (`res[].token`).
// So discoverBotXTokens() stores the pair address in MemeAlphaToken.contract so
// that auditBotXToken(chain, contract) receives a value BotX accepts.
//
// Fails closed: no default key is baked in. When BOTX_API_KEY is unset the
// module throws — the route's per-platform error isolation turns that into a
// 200 response with meta.platformsStatus reporting the error.

import type { MemeAlphaToken, MemeRiskAudit } from '../types'

interface BotXSafetyInfo {
  canMint?: boolean
  mintAuthority?: boolean
  freezeAuthority?: boolean
  canFrozen?: boolean
  top10HolderRate?: number | string
  [key: string]: unknown
}

interface BotXRow {
  id: string
  symbol?: string
  name?: string
  token?: string
  tokenPrice?: number | string
  priceChange24h?: number | string
  buyVolume1h?: number | string
  sellVolume1h?: number | string
  marketCap?: number | string
  tokenCreatedAt?: number | string
  holders?: number | string
  safetyInfo?: BotXSafetyInfo
  [key: string]: unknown
}

interface BotXBasicInfo {
  symbol?: string
  name?: string
  taxes?: number | string
  totalFee?: number | string
  [key: string]: unknown
}

const BOTX_HOST = 'https://api-data-v1.dbotx.com'
const DISCOVERY_CHAINS = ['solana', 'bsc'] as const

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function botxKey(): string {
  const key = process.env.BOTX_API_KEY ?? ''
  if (!key) throw new Error('BOTX_API_KEY not set')
  return key
}

async function botxGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BOTX_HOST + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'x-api-key': botxKey(), accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`BotX ${res.status}: ${path}`)
  const data = (await res.json()) as { err?: boolean; res?: T }
  if (data.err === true) throw new Error(`BotX api error: ${path}`)
  return data.res as T
}

// Lenient variant for audits: transport/API errors => null (route treats null
// as "no audit available" rather than a hard failure).
async function botxGetSafe(path: string, params: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const url = new URL(BOTX_HOST + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': botxKey(), accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { err?: boolean; res?: unknown }
    if (data.err === true) return null
    return data.res ?? null
  } catch {
    return null
  }
}

function deriveDiscoveryRisk(s: BotXRow): number {
  const si: BotXSafetyInfo = s.safetyInfo ?? {}
  if (si.canMint || si.freezeAuthority) return 3
  const top10 = toNum(si.top10HolderRate ?? null)
  if (top10 > 0.3 || si.canFrozen) return 2
  return 0
}

export async function discoverBotXTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  for (const chain of DISCOVERY_CHAINS) {
    const raw = await botxGet<BotXRow[]>(`/kline/new`, {
      chain,
      sortBy: 'pairPriceCreatedAt',
      sort: '-1',
      interval: '1h',
    })
    const rows = Array.isArray(raw) ? raw : []
    for (const s of rows.slice(0, limitPerChain)) {
      const si: BotXSafetyInfo = s.safetyInfo ?? {}
      out.push({
        id: `${chain}:${s.id}`,
        platform: 'botx',
        chain,
        // NOTE: contract = the trading PAIR address (discovery id), not the token address.
        contract: s.id,
        symbol: s.symbol ?? '',
        name: s.name ?? '',
        price: toNum(s.tokenPrice),
        change24h: toNum(s.priceChange24h),
        volume24h: toNum(s.buyVolume1h) + toNum(s.sellVolume1h),
        marketCap: toNum(s.marketCap),
        // BotX new-token endpoint exposes no pool liquidity field; do not fabricate.
        liquidity: 0,
        createdAt: toNum(s.tokenCreatedAt) || null,
        riskLevel: deriveDiscoveryRisk(s),
        holders: toNum(s.holders),
        top10HolderPercent: toNum(si.top10HolderRate ?? null),
        social: {},
        audited: false,
      })
    }
  }
  return out
}

export async function auditBotXToken(chain: string, contract: string): Promise<MemeRiskAudit | null> {
  // `contract` is the pair address; BotX needs it as `pair`.
  const basic = (await botxGetSafe('/kline/pair_info', { chain, pair: contract, type: 'basic' })) as BotXBasicInfo | null
  if (!basic) return null
  const safety = (await botxGetSafe('/kline/pair_info', { chain, pair: contract, type: 'safety' })) as { safetyInfo?: BotXSafetyInfo } | null
  const si: BotXSafetyInfo = safety?.safetyInfo ?? { canMint: false, freezeAuthority: false, canFrozen: false, top10HolderRate: 0 }

  // BotX exposes a single combined `taxes` (basic.type response) — apply to both.
  const taxes = toNum(basic.taxes ?? basic.totalFee ?? null)
  const top10 = toNum(si.top10HolderRate ?? null)

  let riskLevel: number
  if (si.canMint || si.mintAuthority) riskLevel = 3
  else if (si.canFrozen || si.freezeAuthority || top10 > 0.3) riskLevel = 2
  else if (top10 > 0.1) riskLevel = 1
  else riskLevel = 0
  const riskLabel = riskLevel >= 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'

  return {
    id: `${chain}:${contract}`,
    platform: 'botx',
    chain,
    contract,
    symbol: basic.symbol ?? '',
    name: basic.name ?? '',
    riskLevel,
    riskLabel,
    buyTax: taxes,
    sellTax: taxes,
    top10HolderPercent: top10,
    // BotX safety endpoint does not expose LP lock; -1 = unknown (do not fake).
    lpLockedPercent: -1,
    canFreeze: !!si.freezeAuthority,
    canMint: !!si.mintAuthority,
    // BotX gives no per-risk counters; zeros (do not fabricate).
    riskCounts: { high: 0, middle: 0, low: 0 },
    auditedAt: Date.now(),
  }
}
