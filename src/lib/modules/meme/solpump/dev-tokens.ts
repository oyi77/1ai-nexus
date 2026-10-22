import { solpumpFetch } from './solpump-fetch'
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
  type DevHistoryToken,
} from '@/lib/modules/derived/dev-history'
const SOLPUMP_BASE = 'https://trade.solpump.io/api/v2/token'
const FETCH_TIMEOUT_MS = 8_000

// The pipeline's canonical chain label is 'solana' (normalizeChainId), but
// this endpoint only serves the short upstream label — live-proven
// 2026-10-15: /SOL/<mint>/dev-tokens → 200, /solana/<mint>/dev-tokens → 400.
// Every 400 in the cron logs was this, not a rate limit (the same bursts
// replay 200 from curl and from Node one-at-a-time). Mirrors alph.ts's
// ALPH_UPSTREAM_CHAIN reverse map.
const SOLPUMP_UPSTREAM_CHAIN: Record<string, string> = { solana: 'SOL' }

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
 * Normalize one upstream token entry into the classifier's token shape.
 * Only fields upstream actually reported survive: a non-boolean `migrated`
 * becomes null (no outcome), and `rugged` is omitted rather than defaulted to
 * false, so an absent flag can never be read as proof of a clean deploy.
 */
function toDevHistoryToken(raw: unknown): DevHistoryToken {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const token: DevHistoryToken = {
    tokenAddress: typeof t.tokenAddress === 'string' ? t.tokenAddress : '',
    migrated: typeof t.migrated === 'boolean' ? t.migrated : null,
    migrationPct: typeof t.migrationPct === 'number' && Number.isFinite(t.migrationPct)
      ? t.migrationPct
      : null,
    createdAtAgeSeconds:
      typeof t.createdAtAgeSeconds === 'number' && Number.isFinite(t.createdAtAgeSeconds)
        ? t.createdAtAgeSeconds
        : null,
  }
  if (typeof t.rugged === 'boolean') token.rugged = t.rugged
  return token
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
      ? obj.tokens.map(toDevHistoryToken)
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
  const upstreamChain = SOLPUMP_UPSTREAM_CHAIN[chain.toLowerCase()] ?? chain.toUpperCase()
  const url = `${SOLPUMP_BASE}/${encodeURIComponent(upstreamChain)}/${encodeURIComponent(tokenAddress)}/dev-tokens`

  const res = await solpumpFetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
  }, { timeoutMs }).catch(() => null)
  if (!res || !res.ok) {
    if (res) {
      logger.warn(
        `Solpump dev-tokens non-200: ${res.status} ${res.statusText}`,
        'meme:solpump',
      )
    }
    return { devAddress: null, tokens: [] }
  }
  try {
    return parseDevTokensResponse(await res.json())
  } catch (err) {
    logger.warn(
      `Solpump dev-tokens parse failed: ${err instanceof Error ? err.message : String(err)}`,
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
