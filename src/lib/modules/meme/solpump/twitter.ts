// ─────────────────────────────────────────────────────────────
// Module: Solpump — X/Twitter Events (enrichment adapter)
// sourceType: public-api
// upstreamProduct: trade.solpump.io — X/Twitter KOL event feed
// endpoint: https://trade.solpump.io/api/v2/twitter/events
//
// Live-proven keyless 2026-10-15:
//   GET /api/v2/twitter/events         — 200, keyless, no auth
//   GET /api/v2/twitter/events?cursor= — paginated (cursor from nextCursor)
//   GET /api/v2/twitter/authors        — 200, keyless (tracked X authors)
//
// Response shape (verified across 160 events from 8 pages):
//   { events: SolpumpRawEvent[], cursor: string, nextCursor: string|null }
//
// Token linkage: ~7% of events carry a non-null `token` object (when the
// tweet mentions a cashtag/contract Solpump resolves). The token object has:
//   { chain, symbol, address, image, priceUsd, priceUsdStr, priceUsd1h,
//     priceUsd1hStr, marketCapUsd, marketCapUsdStr }
// Events without a token link (tokenType=null, token=null) are general
// KOL tweets (politics, news, replies) — NOT token-related.
//
// Config:
//   SOLPUMP_X_ENABLED="true"  — opt-in flag (default OFF, same pattern as ALPH/FOMO)
//   SOLPUMP_X_SESSION          — optional session token (UNPROVEN; endpoint
//                                is keyless so this is a forward-compat hook)
//
// Graceful degradation: network error / non-200 / malformed JSON → empty
// array, never throws (same contract as other meme modules).
// ─────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

const SOLPUMP_BASE = 'https://trade.solpump.io/api/v2/twitter/events'
const DEFAULT_LIMIT = 50
const FETCH_TIMEOUT_MS = 8_000

// ── Config env cache (mirrors fomo/gmgn reset pattern) ──
let cachedEnabled: boolean | undefined
let cachedSession: string | undefined

export function __resetSolpumpXForTests(): void {
  cachedEnabled = undefined
  cachedSession = undefined
}

// ── Raw API response interfaces (verbatim from live probes) ──

/** Media item inside a tweet event's content or reference. */
export interface SolpumpTweetMedia {
  type: string | null
  url: string | null
}

/** Author of the tweet event. */
export interface SolpumpTweetAuthor {
  handle: string
  name: string
  avatar: string | null
  followers: number | null
  tags: string[] | null
}

/**
 * Token linked to a tweet event. Present only when Solpump resolved a
 * cashtag/contract from the tweet text (~7% of events). All fields
 * optional because the object shape may vary by chain.
 */
export interface SolpumpEventToken {
  chain: string
  symbol: string
  address: string
  image: string | null
  priceUsd: number
  priceUsdStr: string
  priceUsd1h: number
  priceUsd1hStr: string
  marketCapUsd: number
  marketCapUsdStr: string
}

/** Quoted/replied-to tweet reference inside an event. */
export interface SolpumpTweetReference {
  tweetId: string | null
  authorHandle: string | null
  authorName: string | null
  authorAvatar: string | null
  authorFollowers: number | null
  text: string | null
  media: SolpumpTweetMedia[] | null
  type: string | null
  reference: unknown // recursive — null when absent
}

/** Tweet content block. */
export interface SolpumpTweetContent {
  text: string | null
  media: SolpumpTweetMedia[] | null
}

/**
 * Normalized tweet event — the public shape consumed by callers.
 * Token-bearing events carry `token`; all others have `token=null`.
 */
export interface SolpumpTweetEvent {
  id: number
  action: string
  originalAction: string | null
  tweetId: string
  ageSeconds: number | null
  timestamp: number
  timestampStr: string
  author: SolpumpTweetAuthor
  content: SolpumpTweetContent
  tokenType: string | null
  token: SolpumpEventToken | null
  reference: SolpumpTweetReference | null
  unfollowTarget: unknown
  avatarChange: unknown
  bioChange: unknown
}

export interface SolpumpEventsResponse {
  events: SolpumpTweetEvent[]
  cursor: string | null
  nextCursor: string | null
}

// ── Fetch options ──

export interface FetchSolpumpTwitterEventsOpts {
  /** Cursor for pagination (from a prior response's `nextCursor`). */
  cursor?: string
  /**
   * Max number of events to return. The API does not honor a `limit` param
   * (tested: `?limit=5` returns 20 — it's ignored), so we fetch pages of 20
   * and truncate client-side.
   */
  limit?: number
}

/**
 * Parse the raw JSON body into a typed response. Malformed → empty events.
 * Exported for unit testing with fixture strings.
 */
export function parseEventsResponse(body: unknown): SolpumpEventsResponse {
  if (typeof body !== 'object' || body === null) {
    return { events: [], cursor: null, nextCursor: null }
  }
  const obj = body as Record<string, unknown>
  const events = Array.isArray(obj.events) ? (obj.events as SolpumpTweetEvent[]) : []
  return {
    events,
    cursor: typeof obj.cursor === 'string' ? obj.cursor : null,
    nextCursor: typeof obj.nextCursor === 'string' ? obj.nextCursor : null,
  }
}

/**
 * Fetch X/Twitter events from Solpump's public feed.
 *
 * Returns empty array (never throws) when:
 *   - SOLPUMP_X_ENABLED is not "true"
 *   - network error / timeout
 *   - non-200 response
 *   - malformed JSON
 *
 * @returns Normalized SolpumpTweetEvent[] (token-bearing events carry `token`)
 */
export async function fetchSolpumpTwitterEvents(
  opts: FetchSolpumpTwitterEventsOpts = {},
): Promise<SolpumpTweetEvent[]> {
  if (cachedEnabled === undefined) {
    cachedEnabled = process.env.SOLPUMP_X_ENABLED === 'true'
  }
  if (!cachedEnabled) return []

  if (cachedSession === undefined) {
    cachedSession = process.env.SOLPUMP_X_SESSION || undefined
  }

  const limit = opts.limit ?? DEFAULT_LIMIT
  const collected: SolpumpTweetEvent[] = []
  let cursor: string | undefined = opts.cursor

  try {
    // Fetch pages (20 events each) until we hit `limit` or run out of pages.
    // Safety cap: 10 pages (200 events) to prevent unbounded pagination.
    for (let page = 0; page < 10; page++) {
      const url = new URL(SOLPUMP_BASE)
      if (cursor) url.searchParams.set('cursor', cursor)

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      }
      if (cachedSession) {
        headers['Authorization'] = `Bearer ${cachedSession}`
      }

      const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) {
        logger.warn(
          `Solpump X events non-200: ${res.status} ${res.statusText}`,
          'meme:solpump',
        )
        return collected // return whatever we have so far
      }

      const body: unknown = await res.json()
      const parsed = parseEventsResponse(body)
      if (parsed.events.length === 0) break

      collected.push(...parsed.events)
      if (collected.length >= limit) {
        return collected.slice(0, limit)
      }

      if (!parsed.nextCursor) break
      cursor = parsed.nextCursor
    }
  } catch (err) {
    logger.warn(
      `Solpump X events fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      'meme:solpump',
    )
    return collected // partial or empty — never throw
  }

  return collected
}

export interface TokenMentionSummary {
  mentions: number
  authors: Set<string>
  engagement: number
  token: SolpumpEventToken
}

/**
 * Aggregate token mentions across a set of tweet events.
 *
 * Returns a Map keyed by token address, with mention count, distinct author
 * handles, and engagement (sum of author followers as a proxy for reach).
 *
 * Dynamic insertion with unique addresses makes Map the right data structure.
 * Only events with a non-null `token` contribute. Events without a token
 * link are general KOL chatter (not token-related) and are skipped.
 */
export function extractTokenMentions(
  events: SolpumpTweetEvent[],
): Map<string, TokenMentionSummary> {
  const map = new Map<string, TokenMentionSummary>()

  for (const event of events) {
    if (!event.token) continue
    const addr = event.token.address
    if (!addr) continue

    let entry = map.get(addr)
    if (!entry) {
      entry = {
        mentions: 0,
        authors: new Set<string>(),
        engagement: 0,
        token: event.token,
      }
      map.set(addr, entry)
    }

    entry.mentions++
    if (event.author?.handle) entry.authors.add(event.author.handle)
    entry.engagement += event.author?.followers ?? 0
  }

  return map
}
