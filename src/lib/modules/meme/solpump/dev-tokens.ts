// ─────────────────────────────────────────────────────────────
// Module: Solpump — Developer token history (anti-rug adapter)
// sourceType: public-api
// upstreamProduct: trade.solpump.io — per-token developer deploy history
// endpoint: https://trade.solpump.io/api/v2/token/{chain}/{address}/dev-tokens
//
// Live-proven keyless 2026-10-15:
//   GET /api/v2/token/SOL/{address}/dev-tokens — 200, keyless
//
// Response shape (verified):
//   { devAddress, tokens: [{ tokenAddress, tokenName, tokenSymbol, chain,
//     createdAtAgeSeconds, migrated, migrationPct, priceUsd, ... }] }
// `tokens` is the FULL history of every token the developer ever deployed.
//
// The fetched payload maps 1:1 onto DevHistoryInput (derived/dev-history.ts),
// where the PURE decision logic lives. This module is I/O only; the verdict
// is computed by assessDevHistory() from that module.
//
// Config:
//   SOLPUMP_TRENCHES_ENABLED="true" — opt-in flag (default OFF). SHARED with
//     trenches.ts (one flag for the whole anti-rug lifecycle feature set —
//     both scanners are useless without each other; a second flag would
//     only add a half-configured failure mode). Both modules cache it and
//     expose their own __resetForTests().
//
// Graceful degradation: network error / non-200 / malformed JSON →
//   { devAddress: null, tokens: [] }, never throws. Callers treat that as
//   UNPROVEN via the pure classifier.
// ─────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'
import {
  assessDevHistory as assessDevHistoryPure,
  type DevHistoryInput,
  type DevHistoryVerdict,
  type DevHistoryConfig,
} from '@/lib/modules/derived/dev-history'
const SOLPUMP_BASE = 'https://trade.solpump.io/api/v2/token'
const FETCH_TIMEOUT_MS = 8_000

export interface FetchDevTokenHistoryOpts {
  /** Per-request timeout in ms (default 8_000). */
  timeoutMs?: number
}

// ── Config env cache (mirrors twitter.ts reset pattern) ──
let cachedEnabled: boolean | undefined

export function __resetSolpumpDevTokensForTests(): void {
  cachedEnabled = undefined
}

/**
 * Parse the raw JSON body into a DevHistoryInput-compatible object.
 * Malformed → { devAddress: null, tokens: [] }.
 * Exported for unit testing with fixture strings.
 */
export function parseDevTokensResponse(body: unknown): DevHistoryInput {
  if (typeof body !== 'object' || body === null) {
    return { devAddress: null, tokens: [] }
  }
  const obj = body as Record<string, unknown>
  return {
    devAddress: typeof obj.devAddress === 'string' ? obj.devAddress : null,
    tokens: Array.isArray(obj.tokens)
      ? (obj.tokens as DevHistoryInput['tokens'])
      : [],
  }
}

/**
 * Fetch the full deploy history of a token's developer.
 *
 * Returns { devAddress: null, tokens: [] } (never throws) when:
 *   - SOLPUMP_TRENCHES_ENABLED is not "true"
 *   - network error / timeout
 *   - non-200 response
 *   - malformed JSON
 *
 * @param chain        Chain id, e.g. 'SOL'
 * @param tokenAddress Token whose developer history to fetch
 */
export async function fetchDevTokenHistory(
  chain: string,
  tokenAddress: string,
  opts: FetchDevTokenHistoryOpts = {},
): Promise<DevHistoryInput> {
  if (cachedEnabled === undefined) {
    cachedEnabled = process.env.SOLPUMP_TRENCHES_ENABLED === 'true'
  }
  if (!cachedEnabled) return { devAddress: null, tokens: [] }

  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  const url = `${SOLPUMP_BASE}/${encodeURIComponent(chain)}/${encodeURIComponent(tokenAddress)}/dev-tokens`

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      logger.warn(
        `Solpump dev-tokens non-200: ${res.status} ${res.statusText}`,
        'meme:solpump',
      )
      return { devAddress: null, tokens: [] }
    }
    return parseDevTokensResponse(await res.json())
  } catch (err) {
    logger.warn(
      `Solpump dev-tokens fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      'meme:solpump',
    )
    return { devAddress: null, tokens: [] }
  }
}

/**
 * Convenience: fetch the dev history and classify it in one call.
 * On any I/O failure the empty payload flows into the pure classifier,
 * which yields UNPROVEN (never throws). Named per spec after the pure
 * decision function; the pure one is imported above as assessDevHistoryPure.
 */
export async function assessDevHistory(
  chain: string,
  tokenAddress: string,
  opts: FetchDevTokenHistoryOpts & { config?: DevHistoryConfig } = {},
): Promise<DevHistoryVerdict> {
  const input = await fetchDevTokenHistory(chain, tokenAddress, opts)
  return assessDevHistoryPure(input, opts.config)
}
