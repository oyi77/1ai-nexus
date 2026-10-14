// ─────────────────────────────────────────────────────────────
// Module: Solpump — Trenches scanner (anti-rug lifecycle adapter)
// sourceType: public-api
// upstreamProduct: trade.solpump.io — bonding-curve lifecycle scanner
// endpoint: https://trade.solpump.io/api/v2/scanner/trenches/{phase}
//
// Live-proven keyless 2026-10-15:
//   POST /api/v2/scanner/trenches/graduating — 200, body {}, keyless
//   POST /api/v2/scanner/trenches/new        — same shape
//   POST /api/v2/scanner/trenches/graduated  — same shape
//
// Response shape (verified):
//   { tokens: [...], cursor, nextCursor }
// Token row:
//   { chain, pairAddress, tokenAddress, tokenName, tokenSymbol,
//     platformType ("PUMPFUN"), launchPad: { bondingCurve: { state,
//     progressPct }, pumpfun: {...} }, rugged: bool, createdAtAgeSeconds }
//
// Pagination: POST page 1 with body {}; follow `nextCursor` via body
//   { cursor } until it is null or the page cap (default 3) is reached.
//
// Config:
//   SOLPUMP_TRENCHES_ENABLED="true" — opt-in flag (default OFF). This flag
//     is SHARED with dev-tokens.ts (same anti-rug lifecycle feature set);
//     both modules cache it and expose their own __resetForTests().
//
// Graceful degradation: network error / non-200 / malformed JSON → empty
// array, never throws (same contract as twitter.ts and other meme modules).
// ─────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

const SOLPUMP_TRENCHES_BASE =
  'https://trade.solpump.io/api/v2/scanner/trenches'
const FETCH_TIMEOUT_MS = 8_000
const DEFAULT_MAX_PAGES = 3

export type SolpumpTrenchPhase = 'new' | 'graduating' | 'graduated'

/** Bonding-curve state for a trench token (e.g. "Migrating"). */
export interface SolpumpBondingCurve {
  state: string
  progressPct: number
}

/** One row of the trenches scanner response (shape from live probes). */
export interface SolpumpTrenchToken {
  chain: string
  pairAddress: string
  tokenAddress: string
  tokenName: string
  tokenSymbol: string
  platformType: string
  launchPad?: {
    bondingCurve?: SolpumpBondingCurve
    pumpfun?: Record<string, unknown>
  }
  rugged?: boolean
  createdAtAgeSeconds?: number
}

export interface SolpumpTrenchesResponse {
  tokens: SolpumpTrenchToken[]
  cursor: string | null
  nextCursor: string | null
}

export interface FetchSolpumpTrenchesOpts {
  /** Safety cap on pages fetched (default 3). */
  maxPages?: number
  /** Resume pagination from a known cursor. */
  cursor?: string
  /** Per-request timeout in ms (default 8_000). */
  timeoutMs?: number
}

// ── Config env cache (mirrors twitter.ts reset pattern) ──
let cachedEnabled: boolean | undefined

export function __resetSolpumpTrenchesForTests(): void {
  cachedEnabled = undefined
}

/**
 * Parse the raw JSON body into a typed response. Malformed → empty tokens.
 * Exported for unit testing with fixture strings.
 */
export function parseTrenchesResponse(body: unknown): SolpumpTrenchesResponse {
  if (typeof body !== 'object' || body === null) {
    return { tokens: [], cursor: null, nextCursor: null }
  }
  const obj = body as Record<string, unknown>
  const tokens = Array.isArray(obj.tokens) ? (obj.tokens as SolpumpTrenchToken[]) : []
  return {
    tokens,
    cursor: typeof obj.cursor === 'string' ? obj.cursor : null,
    nextCursor: typeof obj.nextCursor === 'string' ? obj.nextCursor : null,
  }
}

/**
 * Fetch trench tokens for one lifecycle phase.
 *
 * Returns empty array (never throws) when:
 *   - SOLPUMP_TRENCHES_ENABLED is not "true"
 *   - network error / timeout
 *   - non-200 response
 *   - malformed JSON
 *
 * @param phase Which scanner endpoint: 'new' | 'graduating' | 'graduated'
 */
export async function fetchSolpumpTrenches(
  phase: SolpumpTrenchPhase,
  opts: FetchSolpumpTrenchesOpts = {},
): Promise<SolpumpTrenchToken[]> {
  if (cachedEnabled === undefined) {
    cachedEnabled = process.env.SOLPUMP_TRENCHES_ENABLED === 'true'
  }
  if (!cachedEnabled) return []

  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  const collected: SolpumpTrenchToken[] = []
  let cursor: string | undefined = opts.cursor

  try {
    for (let page = 0; page < maxPages; page++) {
      const body: Record<string, string> = cursor ? { cursor } : {}

      const res = await fetch(`${SOLPUMP_TRENCHES_BASE}/${phase}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        logger.warn(
          `Solpump trenches ${phase} non-200: ${res.status} ${res.statusText}`,
          'meme:solpump',
        )
        return []
      }

      const bodyJson: unknown = await res.json()
      const parsed = parseTrenchesResponse(bodyJson)
      if (parsed.tokens.length === 0) break

      collected.push(...parsed.tokens)
      if (!parsed.nextCursor) break
      cursor = parsed.nextCursor
    }
  } catch (err) {
    logger.warn(
      `Solpump trenches ${phase} fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      'meme:solpump',
    )
    return []
  }

  return collected
}

// ── Graduating sweet-spot classifier (pure) ──

export interface GraduatingSweetSpotConfig {
  /** Inclusive lower bound on bonding-curve progress (default 85). */
  minProgressPct: number
  /** Exclusive upper bound — 100 means already migrated (default 100). */
  maxProgressPct: number
}

export const GRADUATING_SWEET_SPOT_DEFAULTS: GraduatingSweetSpotConfig = {
  minProgressPct: 85,
  maxProgressPct: 100,
}

/**
 * True when a trench token is a PumpFun bonding curve in the "about to
 * graduate" window: progress in [min, max) and not rugged. Pure function.
 */
export function isGraduatingSweetSpot(
  token: SolpumpTrenchToken,
  cfg?: Partial<GraduatingSweetSpotConfig>,
): boolean {
  const c = { ...GRADUATING_SWEET_SPOT_DEFAULTS, ...(cfg ?? {}) }
  if (token.platformType !== 'PUMPFUN') return false
  if (token.rugged === true) return false
  const progress = token.launchPad?.bondingCurve?.progressPct
  if (typeof progress !== 'number') return false
  return progress >= c.minProgressPct && progress < c.maxProgressPct
}
