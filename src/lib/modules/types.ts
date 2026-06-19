// ─────────────────────────────────────────────────────────────
// NEXUS Module Type System v4.1
// Zero-API-Key Architecture · RE Module Framework
// ─────────────────────────────────────────────────────────────

export type SourceType =
  | 'public-api'   // Official free public API, documented, no key
  | 'public-rpc'   // Direct blockchain node / WebSocket
  | 'oss-mirror'   // Free-hosted open-source mirror of a paid product
  | 're'           // Reverse-engineered frontend/internal endpoint
  | 'derived'      // Computed from other modules' data, no external call

export type DataCategory =
  | 'onchain' | 'market' | 'defi' | 'derivatives' | 'macro'
  | 'equities' | 'forex' | 'commodities' | 'news' | 'sentiment'
  | 'prediction' | 'ai-signals'

export type ModuleStatus = 'active' | 'degraded' | 'offline'

export type Fragility = 'stable' | 'moderate' | 'fragile'

export type DiscoveryMethod = 'docs' | 'devtools-network-tab' | 'community-package' | 'computed'

export type ReConfidence = 'green' | 'yellow'  // 🟢 / 🟡

export interface ModuleProvenance {
  /** 1-line self-description */
  describesItself: string
  /** What paid product this replaces (for re/oss-mirror) */
  upstreamProduct?: string
  /** How the endpoint was discovered */
  discoveredVia?: DiscoveryMethod
  /** Stability rating — re modules start at 'fragile' */
  fragility: Fragility
  /** ISO date — RE modules re-verified weekly */
  lastVerified: string
  /** ALWAYS true — losing a module degrades, never breaks */
  toleratesAbsence: boolean
}

export interface ModuleHealth {
  status: ModuleStatus
  lastChecked: Date
  lastSuccess?: Date
  failureCount: number
  notes?: string
}

export interface FetchParams {
  [key: string]: string | number | boolean | undefined
}

export interface ModuleResult<T = unknown> {
  data: T
  source: string
  cached: boolean
  timestamp: number
  ttl: number
}

export interface DataModule {
  id: string
  name: string
  category: DataCategory
  sourceType: SourceType
  provenance: ModuleProvenance

  /** true unless circuit-broken; NEVER false for "missing key" */
  isEnabled(): boolean

  /** Health check */
  healthCheck(): Promise<ModuleHealth>

  /** Fetch data */
  fetch<T = unknown>(params: FetchParams): Promise<ModuleResult<T>>

  /** MANDATORY for sourceType === 're' */
  fallbackFn?<T = unknown>(params: FetchParams): Promise<ModuleResult<T>>
}

// ─── RE Module File Header Template ─────────────────────────
// Every re sourceType module file must start with:
//
// /**
//  * Module: <name>
//  * sourceType: re
//  * upstreamProduct: <what paid product this replaces>
//  * endpoint: <base URL of the RE endpoint>
//  * discoveredVia: devtools-network-tab | community-package
//  * lastVerified: <ISO date>
//  * UNOFFICIAL: this calls <provider>'s internal frontend API, not their public API.
//  *   It may break without notice if they change their dashboard.
//  *   fallbackFn: <fallback module id>
//  */

// ─── TTL Constants (milliseconds) ───────────────────────────

export const TTL = {
  // public-api
  PRICE_DATA:        15_000,   // 15s
  ENTITY_LABEL:     600_000,   // 10 min
  NEWS:             300_000,   // 5 min
  MACRO_DATA:      3_600_000,  // 1 hour
  TVL_DATA:         300_000,   // 5 min
  TOKEN_DATA:        60_000,   // 1 min
  DERIVATIVES:       30_000,   // 30s
  SENTIMENT:        300_000,   // 5 min
  PREDICTION:       120_000,   // 2 min

  // RE multiplier: 2–4× the equivalent public-api TTL
  RE_MULTIPLIER: 3,
} as const


export function getSourceTypeLabel(st: SourceType): string {
  switch (st) {
    case 'public-api':  return 'Public API'
    case 'public-rpc':  return 'Public RPC'
    case 'oss-mirror':  return 'OSS Mirror'
    case 're':          return 'Reverse-Engineered'
    case 'derived':     return 'Derived'
  }
}
