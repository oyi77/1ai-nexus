// ─────────────────────────────────────────────────────────────
// Meme-Alpha — shared types
//
// Normalized token shape shared by meme discovery and risk adapters. Two surfaces:
//   1. New-token discovery  (the "catch the next 100x" feed)
//   2. Honeypot / rug audit  (risk scoring before you ape in)
// ─────────────────────────────────────────────────────────────

export type MemePlatform = 'bitget' | 'gate' | 'moby' | 'botx' | 'dexscreener' | 'birdeye' | 'rugcheck' | 'geckoterminal' | 'gmgn' | 'fomo' | 'photon' | 'nansen' | 'axiom'

export const MEME_PLATFORMS: MemePlatform[] = [
  'bitget',
  'gate',
  'botx',
  // Platform order is stable for API output; registry capability and
  // credentials determine which entries are enabled at runtime.
  'moby',
  'dexscreener',
  // Platform inventory (discovery and/or risk capability varies by adapter):
  //   birdeye  — forge API (discovery + security audit)
  //   rugcheck — security report (audit only)
  //   geckoterminal — trending/new pools discovery
  // gmgn/fomo are credential/flag-gated in the registry; photon remains
  // a disabled stub so pages/APIs can enumerate the platform.
  //   nansen — smart-money screener (MOBY_NANSEN_API_KEY gated)
  //   axiom  — contract risk audit (AXIOM_API_KEY gated)
  'birdeye',
  'rugcheck',
  'geckoterminal',
  'gmgn',
  'fomo',
  'photon',
  'nansen',
  'axiom',
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
  /** Optional buy/sell transaction counts (24h — from GeckoTerminal etc.). */
  buyCount24h?: number
  sellCount24h?: number
  /**
   * Optional smart-money flow (Nansen sm-filtered screener). All subfields
   * optional, undefined-by-default so other adapters are untouched.
   */
  smartMoney?: {
    traderCount?: number
    buyVolumeUsd?: number
    sellVolumeUsd?: number
    netflowUsd?: number
    inflowFdvRatio?: number
    outflowFdvRatio?: number
    labeled?: boolean
  }
  /**
   * Provenance of the discovery row. Optional — absent on rows created
   * before this field existed. `provider` mirrors `platform`.
   */
  provenance?: {
    /** 'public-api' = documented public API; 'reverse-engineered' = RE'd from a web app. */
    sourceType: 'public-api' | 'reverse-engineered'
    provider: MemePlatform
    /** True when the source is not a stable, documented public API. */
    experimental?: boolean
    /** Free-text note on source / verification status. */
    note?: string
  }
  /** False when discovery carried no real risk assessment (riskLevel is a placeholder). */
  riskKnown?: boolean
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
  /** Present when requested via `?explain=1` — per-token score decomposition. */
  explanations?: Record<
    string,
    { score: number; reasons: { points: number; code: string; label: string }[]; flowSignal?: unknown }
  >
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
  /** Honeypot detection flag (GMGN/Axiom supported). */
  isHoneypot: boolean
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