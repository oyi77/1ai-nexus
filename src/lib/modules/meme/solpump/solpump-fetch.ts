// ─────────────────────────────────────────────────────────────
// Module: Solpump — shared HTTP client for trade.solpump.io
//
// Both solpump adapters (dev-tokens.ts, trenches.ts) hit the same host and
// get burst-rejected with 400 when the sniper's per-pass fan-out fires 5-8
// concurrent requests (live-proven 2026-10-15: every single replay returns
// 200 while the cron's burst logs non-200 for all of them). This client
// serializes requests with a module-level minimum gap and retries
// transient failures (400/429/5xx/network) with linear backoff.
//
// Config:
//   SOLPUMP_REQUEST_GAP_MS — min gap between requests (default 700)
//   SOLPUMP_MAX_RETRIES    — retries on 400/429/5xx/network (default 2)
// ─────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

/** Minimum gap between consecutive requests to trade.solpump.io (ms). */
const DEFAULT_MIN_REQUEST_GAP_MS = 700
/** Backoff schedule between retries (ms), linear: 1.5s then 3s. */
const RETRY_BACKOFF_MS = [1_500, 3_000]
/** Static status table worth retrying: burst rejection (400), rate limit (429), server trouble. */
const RETRYABLE_STATUS: Record<number, true> = { 400: true, 429: true, 500: true, 502: true, 503: true, 504: true }

export interface SolpumpFetchOpts {
  /** Per-request timeout in ms (default 8_000). */
  timeoutMs?: number
}

/** Env override cache (mirrors the twitter.ts reset pattern). */
let cachedGapMs: number | undefined
let cachedMaxRetries: number | undefined

export function __resetSolpumpFetchForTests(): void {
  cachedGapMs = undefined
  cachedMaxRetries = undefined
  lastRequestAt = 0
  queueTail = Promise.resolve()
}

function requestGapMs(): number {
  if (cachedGapMs === undefined) {
    const parsed = Number.parseInt(process.env.SOLPUMP_REQUEST_GAP_MS ?? '', 10)
    cachedGapMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_REQUEST_GAP_MS
  }
  return cachedGapMs
}

function maxRetries(): number {
  if (cachedMaxRetries === undefined) {
    const parsed = Number.parseInt(process.env.SOLPUMP_MAX_RETRIES ?? '', 10)
    cachedMaxRetries = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2
  }
  return cachedMaxRetries
}

/** Serialized request queue — the gap applies across ALL solpump adapters. */
let lastRequestAt = 0
let queueTail: Promise<void> = Promise.resolve()

/**
 * Spaced, retrying fetch to trade.solpump.io. Resolves the raw Response on
 * terminal non-retryable statuses (caller decides graceful degradation) and
 * throws only on network errors after the retry budget is exhausted. Each
 * logical request (including its retries) is queued so the minimum gap
 * holds across concurrent callers in the same process.
 */
export async function solpumpFetch(
  url: string,
  init: RequestInit,
  opts: SolpumpFetchOpts = {},
): Promise<Response> {
  const gap = requestGapMs()
  const retries = maxRetries()
  const timeoutMs = opts.timeoutMs ?? 8_000

  // Serialize: this request (and its retries) runs after every prior one.
  const run = queueTail.then(async () => {
    for (let attemptNo = 0; ; attemptNo++) {
      // Hold the module-level gap since the previous request fired.
      const elapsed = Date.now() - lastRequestAt
      if (lastRequestAt > 0 && elapsed < gap) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, gap - elapsed)
        await promise
      }
      lastRequestAt = Date.now()

      let res: Response
      try {
        res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      } catch (err) {
        if (attemptNo < retries) {
          const backoff = RETRY_BACKOFF_MS[Math.min(attemptNo, RETRY_BACKOFF_MS.length - 1)]
          logger.warn(
            `Solpump fetch failed (${err instanceof Error ? err.message : String(err)}) — retry ${attemptNo + 1}/${retries} in ${backoff}ms`,
            'meme:solpump',
          )
          const { promise, resolve } = Promise.withResolvers<void>()
          setTimeout(resolve, backoff)
          await promise
          continue
        }
        throw err
      }

      if (res.ok || !RETRYABLE_STATUS[res.status]) return res
      if (attemptNo < retries) {
        const backoff = RETRY_BACKOFF_MS[Math.min(attemptNo, RETRY_BACKOFF_MS.length - 1)]
        logger.warn(
          `Solpump ${res.status} on ${url} — retry ${attemptNo + 1}/${retries} in ${backoff}ms`,
          'meme:solpump',
        )
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, backoff)
        await promise
        continue
      }
      return res
    }
  })
  queueTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
