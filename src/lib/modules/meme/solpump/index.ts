// ─────────────────────────────────────────────────────────────
// Solpump — Meme platform registry entry
//
// Wraps the X/Twitter events enrichment adapter (twitter.ts) into the
// meme-platform registry so routes can enumerate it. The platform exposes
// a discovery function that returns token-bearing tweet events normalized
// to MemeAlphaToken rows. Only events with a linked token (address +
// price data) are surfaced; general KOL chatter without a token link is
// dropped during normalization.
//
// Auth: keyless public API (verified 2026-10-15). Enabled only when
// SOLPUMP_X_ENABLED="true" — same opt-in pattern as alph/fomo.
// ─────────────────────────────────────────────────────────────

import { fetchSolpumpTwitterEvents, type SolpumpTweetEvent } from './twitter'
import { logger } from '@/lib/logger'
import type { MemeAlphaToken } from '../types'
import { normalizeChainId } from '../normalize'

/**
 * Convert token-bearing Solpump tweet events into MemeAlphaToken rows.
 * Events without a token link are skipped (they are general KOL chatter).
 */
function solpumpEventsToTokens(events: SolpumpTweetEvent[]): MemeAlphaToken[] {
  const tokens: MemeAlphaToken[] = []
  const seenAddresses = new Set<string>()

  for (const event of events) {
    if (!event.token) continue
    const tk = event.token
    const addr = tk.address
    if (!addr || seenAddresses.has(addr)) continue
    seenAddresses.add(addr)

    const chain = normalizeChainId(tk.chain)
    tokens.push({
      id: `${chain}:${addr}`,
      platform: 'solpump',
      chain,
      contract: addr,
      symbol: tk.symbol ?? '',
      name: tk.symbol ?? '',
      price: tk.priceUsd ?? 0,
      change24h: 0, // Solpump token object carries only priceUsd1h, not 24h change
      volume24h: 0, // not provided in the tweet event token object
      marketCap: tk.marketCapUsd ?? 0,
      liquidity: 0, // not provided
      createdAt: event.timestamp ?? null,
      riskLevel: 0,
      holders: 0,
      top10HolderPercent: 0,
      social: {},
      audited: false,
      riskKnown: false,
      provenance: {
        sourceType: 'public-api',
        provider: 'solpump',
        experimental: true,
        note: 'Enriched from Solpump X/Twitter KOL event feed (token-linked tweets)',
      },
    })
  }

  return tokens
}

/**
 * Discover tokens mentioned in Solpump's X/Twitter KOL event feed.
 * Returns empty array (never throws) when disabled or unreachable.
 */
export async function discoverSolpumpTokens(limit?: number): Promise<MemeAlphaToken[]> {
  if (process.env.SOLPUMP_X_ENABLED !== 'true') return []

  try {
    const events = await fetchSolpumpTwitterEvents({ limit })
    const tokens = solpumpEventsToTokens(events)
    if (limit !== undefined) {
      return tokens.slice(0, limit)
    }
    return tokens
  } catch (err) {
    logger.warn(
      `Solpump discovery failed: ${err instanceof Error ? err.message : String(err)}`,
      'meme:solpump',
    )
    return []
  }
}

export { fetchSolpumpTwitterEvents, extractTokenMentions } from './twitter'
export type {
  SolpumpTweetEvent,
  SolpumpEventToken,
  SolpumpTweetAuthor,
  SolpumpTweetContent,
  SolpumpTweetMedia,
  SolpumpTweetReference,
  SolpumpEventsResponse,
  FetchSolpumpTwitterEventsOpts,
  TokenMentionSummary,
} from './twitter'
