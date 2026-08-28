// ─────────────────────────────────────────────────────────────
// Meme-Alpha — shared types
//
// Normalized token shape common to Bitget Wallet, Gate.io DEX, and
// Moby (moby.win). Two surfaces:
//   1. New-token discovery  (the "catch the next 100x" feed)
//   2. Honeypot / rug audit  (risk scoring before you ape in)
// ─────────────────────────────────────────────────────────────

export type MemePlatform = 'bitget' | 'gate' | 'moby' | 'botx' | 'dexscreener'

export const MEME_PLATFORMS: MemePlatform[] = [
  'bitget',
  'gate',
  // Moby module is pending APK RE — registered so pages/APIs can
  // enumerate it, but disabled in the meme registry until it lands.
  'moby',
  'dexscreener',
]

/** Normalized new-token discovery row — shared across platforms. */
export interface MemeAlphaToken {
  /** Platform-scoped unique id (chain:contract). */
  id: string
  platform: MemePlatform
  chain: string
  contract: string
  symbol: string
  name: string
  /** USD price (0 when unknown). */
  price: number
  /** 24h price change as a fraction (0..1). */
  change24h: number
  /** 24h volume in USD. */
  volume24h: number
  /** Market cap in USD. */
  marketCap: number
  /** Liquidity in USD. */
  liquidity: number
  /** Token creation / listing timestamp (ms epoch). */
  createdAt: number | null
  /** Risk level 0..3 (0 = safe, 3 = high). Higher = riskier. */
  riskLevel: number
  /** Holder count. */
  holders: number
  /** Top-10 holder concentration as a fraction (0..1). */
  top10HolderPercent: number
  /** Social links (twitter/telegram/site) when available. */
  social: { twitter?: string; telegram?: string; site?: string }
  /** True when the discovery row also carries a fresh honeypot audit. */
  audited: boolean
}

export interface MemeDiscoveryResponse {
  tokens: MemeAlphaToken[]
  meta: {
    platforms: MemePlatform[]
    total: number
    updatedAt: string
    /** Per-source status for error isolation (mirrors copy-trading). */
    platformsStatus: Record<string, { ok: boolean; error?: string }>
  }
}

/** Normalized honeypot / rug audit row. */
export interface MemeRiskAudit {
  id: string
  platform: MemePlatform
  chain: string
  contract: string
  symbol: string
  name: string
  /** 0 safe · 1 low · 2 middle · 3 high. */
  riskLevel: number
  riskLabel: 'safe' | 'low' | 'middle' | 'high'
  /** Buy tax as fraction (0..1). */
  buyTax: number
  /** Sell tax as fraction (0..1). */
  sellTax: number
  /** Top-10 holder concentration as fraction (0..1). */
  top10HolderPercent: number
  /** LP locked fraction (0..1); -1 when unknown. */
  lpLockedPercent: number
  /** Freeze / mint authority flags when known. */
  canFreeze: boolean
  canMint: boolean
  /** Raw upstream risk counters (platform-specific). */
  riskCounts: { high: number; middle: number; low: number }
  auditedAt: number
}

export interface MemeRiskResponse {
  audits: MemeRiskAudit[]
  meta: {
    platforms: MemePlatform[]
    updatedAt: string
    platformsStatus: Record<string, { ok: boolean; error?: string }>
  }
}
