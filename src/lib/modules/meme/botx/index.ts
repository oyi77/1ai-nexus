// BotX (dbotx) meme-alpha / new-token + honeypot-risk discovery.
//
// Now uses CredentialManager for automatic key rotation and rate-limit handling.
// Falls back to BOTX_API_KEY env var if no keys in store.

import type { MemeAlphaToken, MemeRiskAudit } from '../types'
import { getCredentialManager } from '../_auth/credential-manager'

const BOTX_HOST = 'https://api-data-v1.dbotx.com'
const DISCOVERY_CHAINS = ['solana', 'bsc'] as const

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Key Rotation ─────────────────────────────────────────────

async function botxKey(): Promise<string> {
  const cm = getCredentialManager()
  const keys = cm.getAllKeys()
  if (keys.length === 0) {
    const envKey = process.env.BOTX_API_KEY
    if (!envKey) throw new Error('No BotX keys available — set BOTX_API_KEY or register keys via CredentialManager')
    return envKey
  }

  const key = cm.getNextKey()
  if (!key) throw new Error('No healthy BotX keys — all rate limited or unhealthy')
  return key.apiKey
}

async function withKeyRotation<T>(fn: (key: string) => Promise<T>): Promise<T> {
  const cm = getCredentialManager()
  const keys = cm.getAllKeys()
  const maxRetries = Math.min(keys.length || 1, 5)

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = await botxKey()
    try {
      const result = await fn(key)
      const keyObj = keys.find(k => k.apiKey === key)
      if (keyObj) cm.markHealthy(keyObj.id)
      return result
    } catch (e) {
      const keyObj = keys.find(k => k.apiKey === key)
      if (!keyObj) throw e

      const errorMsg = e instanceof Error ? e.message : String(e)
      if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
        cm.markRateLimited(keyObj.id)
        continue
      }

      if (errorMsg.includes('401') || errorMsg.includes('403')) {
        cm.markUnhealthy(keyObj.id)
        continue
      }

      throw e
    }
  }

  throw new Error('All BotX keys exhausted — rate limited or unhealthy')
}

// ── HTTP ─────────────────────────────────────────────────────

async function botxGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  return withKeyRotation(async (key) => {
    const url = new URL(BOTX_HOST + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'Accept': 'application/json',
      },
    })
    if (!res.ok) throw new Error(`BotX HTTP ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  })
}

async function botxGetSafe(path: string, params: Record<string, string> = {}): Promise<unknown | null> {
  try {
    return await botxGet(path, params)
  } catch {
    return null
  }
}

// ── Types ────────────────────────────────────────────────────

interface BotXRow {
  id: string
  mint: string
  name: string
  symbol: string
  supply: number
  buyAndSellTimes1h: number
  buyAndSellVolume1h: number
  buyTimes1h: number
  buyVolume1h: number
  priceChange1h: number
  priceChange1m: number
  priceChange24h: number
  priceChange5m: number
  priceChange6h: number
  sellTimes1h: number
  sellVolume1h: number
  image: string
  totalFee: number
  rate: number
  tokenPrice: number
  tokenPriceUsd: number
  marketCap: number
  marketCapChange5m: number
  tokenReserve: number
  currencyReserve: number
  solReserve: number
  baseMint: string
  baseSymbol: string
  devAccount: string
  holders: number
  poolType: string
  devHoldPercent: number
  links: Array<{ label: string; url: string }>
}

interface BotXBasicInfo {
  _id: string
  mint: string
  symbol: string
  image: string
  supply: number
  totalFee: number
  tokenPrice: number
  tokenPriceUsd: number
  marketCap: number
  tokenReserve: number
  currencyReserve: number
  solReserve: number
  baseMint: string
  baseSymbol: string
  devAccount: string
  holders: number
  poolType: string
  devHoldPercent: number
  links: Array<{ label: string; url: string }>
}

// ── Discovery ────────────────────────────────────────────────

function deriveDiscoveryRisk(s: BotXRow): number {
  let score = 0
  if (s.priceChange1h > 100) score++
  if (s.priceChange1h < -50) score++
  if (s.buyAndSellVolume1h < 100) score++
  return Math.min(3, score)
}

export async function discoverBotXTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  const seen = new Set<string>()

  for (const chain of DISCOVERY_CHAINS) {
    try {
      const data = await botxGet<{ err: boolean; res: BotXRow[] }>(
        '/kline/new',
        {
          chain,
          sortBy: 'pairPriceCreatedAt',
          sort: '-1',
          interval: '1h',
          limit: String(limitPerChain * 2),
        }
      )

      if (data.err || !Array.isArray(data.res)) continue

      for (const row of data.res) {
        if (!row.mint || !row.symbol) continue
        const id = `${chain}:${row.mint}`
        if (seen.has(id)) continue
        seen.add(id)

        out.push({
          id,
          platform: 'botx',
          chain,
          contract: row.id,  // Use pair address for audit (BotX requires pair, not mint)
          symbol: row.symbol,
          name: row.name || row.symbol,
          price: toNum(row.tokenPriceUsd),
          change24h: toNum(row.priceChange24h),
          volume24h: toNum(row.buyAndSellVolume1h),
          marketCap: toNum(row.marketCap),
          liquidity: toNum(row.tokenReserve),
          createdAt: null,
          riskLevel: deriveDiscoveryRisk(row),
          holders: toNum(row.holders),
          top10HolderPercent: 0,
          social: {},
          audited: false,
        })

        if (out.length >= limitPerChain) break
      }
    } catch {
      // Per-source error isolation
    }

    if (out.length >= limitPerChain) break
  }

  return out
}

// ── Risk Audit ───────────────────────────────────────────────

export async function auditBotXToken(chain: string, contract: string): Promise<MemeRiskAudit | null> {
  try {
    const basic = (await botxGetSafe('/kline/pair_info', { chain, pair: contract, type: 'basic' })) as {
      err: boolean
      res: BotXBasicInfo
    } | null

    const safety = (await botxGetSafe('/kline/pair_info', { chain, pair: contract, type: 'safety' })) as {
      err: boolean
      res: {
        safetyInfo: {
          canFrozen: boolean
          freezeAuthority: boolean
          canMint: boolean
          mintAuthority: boolean
          devPosition: string
        }
      }
    } | null

    if (!basic?.res) return null

    const r = basic.res
    const si = safety?.res?.safetyInfo
    
    // Calculate risk level from safety info
    let riskLevel = 0
    if (si?.freezeAuthority) riskLevel++
    if (si?.mintAuthority) riskLevel++
    if (si?.devPosition === 'increased') riskLevel++
    riskLevel = Math.min(3, riskLevel)
    
    const riskLabel = (['safe', 'low', 'middle', 'high'][riskLevel] || 'unknown') as MemeRiskAudit['riskLabel']

    return {
      id: `${chain}:${r.mint}`,
      platform: 'botx',
      chain,
      contract: r.mint,
      symbol: r.symbol,
      name: '',
      riskLevel,
      riskLabel,
      buyTax: toNum(r.totalFee),
      sellTax: toNum(r.totalFee),
      top10HolderPercent: toNum(r.devHoldPercent),
      lpLockedPercent: -1,
      canFreeze: si?.canFrozen ?? false,
      canMint: si?.canMint ?? false,
      riskCounts: { high: 0, middle: 0, low: 0 },
      auditedAt: Date.now(),
    }
  } catch {
    return null
  }
}
