// ─────────────────────────────────────────────────────────────
// Realtime sniper bridge — WebSocket hype events → sniper gates.
//
// The `nexus-ws` process (ws-server/memecoins.ts) already streams live
// new-token / boost events, but its Telegram path (`scheduleTelegramAlert`)
// gates on a HYPE score (`ws-server/score.ts`, threshold 75) computed from
// boosts / volume / liquidity / FDV / swap count. That score proves
// POPULARITY, not SAFETY: it never reads mint/freeze authority, LP lock,
// honeypot state, holder distribution, or smart-money backing.
//
// This module is the bridge: it takes one `ScoredToken` from the WS scorer,
// converts it into the discovery row the sniper pipeline understands, and
// pushes it through the REAL gates (audit fan-out → `evaluateSniper` ebook
// profiles → `classifySignalTier`). Delivery only happens when the tier
// passes the operator's policy, so the hype path can never bypass policy D.
//
// Three guards keep a live firehose from turning into spam:
//   1. env gate   — SNIPER_REALTIME_ENABLED (default 'false'): inert until
//                   the operator flips it. Existing WS behaviour is intact.
//   2. rate limit — SNIPER_REALTIME_MAX_EVENTS_PER_MIN (default 4), sliding
//                   window. Over-limit events are DROPPED, never queued: a
//                   stale hype event is worthless minutes later.
//   3. cooldown   — SNIPER_REALTIME_COOLDOWN_MS (default 15m) per contract,
//                   enforced through the pipeline's own seen-state.
//
// ─────────────────────────────────────────────────────────────

import { runSniperScan, type SniperScanDeps, type SniperScanResult } from './sniper-scan'
import { appendSniperScan } from './sniper-log'
import { DEFAULT_DELIVERY_POLICY, type DeliveryPolicy } from './signal-tier'
import type { SniperEnrichedToken } from './sniper-source'

/**
 * Structural mirror of `ScoredToken` from ws-server/score.ts.
 *
 * Declared structurally (not imported) on purpose: `ws-server/` is a
 * separate TS project (own tsconfig, excluded from the Next.js program) and
 * its module graph is CommonJS. Only the field contract crosses the
 * boundary — a plain object serialized over the wire.
 */
export interface RealtimeScoredToken {
  address: string
  chain: string
  name?: string
  symbol?: string
  priceUsd?: number
  fdv?: number
  liquidity?: number
  volume24h?: number
  boosts?: number
  age?: number // seconds since first seen
  score?: number // 0-100 hype score (reported, never trusted as a gate)
  risk?: string
  sources?: string[]
  firstSeen?: number
  swapCount?: number
}

export interface RealtimeBridgeResult {
  /** False when SNIPER_REALTIME_ENABLED is not 'true' — nothing was touched. */
  enabled: boolean
  /** True when the event was dropped before evaluation (rate limit / no id). */
  skipped: boolean
  reason?: string
  /** Present only when the event reached the real sniper gates. */
  result?: SniperScanResult
}

/**
 * Core env truthiness — only the literal 'true' turns a feature on.
 *
 * 4 call sites (env gate, watchlist opt-in, plus mirrored repo usage) rely
 * on one identical comparison, so the name earns its keep. Pure.
 */
export function envFlag(raw: string | undefined | null): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true'
}

// ─────────────────────────────────────────────────────────────
// Config — all operator-tunable, all default-off / conservative.
// ─────────────────────────────────────────────────────────────

export const REALTIME_WINDOW_MS = 60_000
export const REALTIME_DEFAULT_MAX_PER_MIN = 4
export const REALTIME_DEFAULT_COOLDOWN_MS = 15 * 60_000

export function realtimeEnabled(): boolean {
  return envFlag(process.env.SNIPER_REALTIME_ENABLED)
}

export function maxEventsPerMinute(): number {
  const raw = Number(process.env.SNIPER_REALTIME_MAX_EVENTS_PER_MIN)
  if (!Number.isFinite(raw) || raw <= 0) return REALTIME_DEFAULT_MAX_PER_MIN
  return Math.floor(raw)
}

export function contractCooldownMs(): number {
  const raw = Number(process.env.SNIPER_REALTIME_COOLDOWN_MS)
  if (!Number.isFinite(raw) || raw < 0) return REALTIME_DEFAULT_COOLDOWN_MS
  return Math.floor(raw)
}

/**
 * Delivery policy for realtime events.
 *
 * Starts from the shared DEFAULT_DELIVERY_POLICY (allowTopSignal=true,
 * allowWatchlist=false) so policy D holds, then honours the SAME operator
 * opt-in the cron uses — a realtime event must never be more permissive
 * than the cron path, or the firehose becomes a WATCHLIST spam channel.
 */
export function realtimeDeliveryPolicy(): DeliveryPolicy {
  return {
    ...DEFAULT_DELIVERY_POLICY,
    allowWatchlist: process.env.SNIPER_DELIVER_WATCHLIST === 'true',
  }
}

// ─────────────────────────────────────────────────────────────
// Sliding-window rate limiter (pure)
// ─────────────────────────────────────────────────────────────

export interface RateLimitState {
  /** Timestamps (ms) of accepted events. */
  events: number[]
}

export function createRateLimitState(): RateLimitState {
  return { events: [] }
}

/** Timestamps that fell out of the trailing window, ascending. Pure. */
export function withinWindow(events: readonly number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs
  return events.filter((t) => t > cutoff)
}

/**
 * Decide whether one more event may pass; on accept the window is mutated.
 *
 * The limit is inclusive: with limit=4 the 4th event inside the window
 * passes and the 5th is dropped. A window rollover frees the slots again.
 */
export function allowEvent(
  state: RateLimitState,
  now: number,
  windowMs: number,
  limit: number,
): boolean {
  state.events = withinWindow(state.events, now, windowMs)
  if (limit <= 0 || state.events.length >= limit) return false
  state.events.push(now)
  return true
}

// ─────────────────────────────────────────────────────────────
// ScoredToken → discovery row
// ─────────────────────────────────────────────────────────────

/**
 * Convert one WS-scored token into the discovery row the sniper pipeline
 * consumes. Pure.
 *
 * Mapping rules (UNKNOWN discipline — nothing is invented):
 *   - `address` → `contract` (the chain-aware identity of the mint)
 *   - `fdv`     → `marketCap` (FDV is the only valuation the WS scorer
 *                 carries; 0/absent stays 0 = "never proved")
 *   - `firstSeen` → `createdAt` (token age as the WS process observed it).
 *     Absent → null, which the payload builder maps to an unknown age and
 *     therefore the STRICTER post-bonding gates — never a fabricated
 *     "brand new" row that would earn the easier new-pair thresholds.
 *   - `volume5m` is deliberately NOT set from `volume24h`: a 24h figure
 *     used as 5m flow would fake the momentum gate. The pipeline refetches
 *     live 5m volume during enrichment; absent flow → dead momentum → REJECT.
 *   - `audited: false` / `riskKnown: false`: the WS hype score is not a risk
 *     assessment, and claiming otherwise would skip the audit fan-out.
 */
export function scoredTokenToCandidate(token: RealtimeScoredToken): SniperEnrichedToken {
  const chain = token.chain || 'solana'
  const contract = (token.address ?? '').trim()
  const symbol = (token.symbol ?? '').trim()
  const name = (token.name ?? '').trim()
  const label = symbol || name || contract.slice(0, 8)
  const price = Number(token.priceUsd)
  const marketCap = Number(token.fdv)
  const liquidity = Number(token.liquidity)
  const volume24h = Number(token.volume24h)
  const firstSeen = Number(token.firstSeen)
  const positive = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0)
  const hypeScore = Number(token.score)

  return {
    id: `ws:${chain}:${contract}`,
    platform: 'dexscreener',
    chain,
    contract,
    symbol: label,
    name: name || label,
    price: positive(price),
    change24h: 0,
    volume24h: positive(volume24h),
    marketCap: positive(marketCap),
    liquidity: positive(liquidity),
    createdAt: Number.isFinite(firstSeen) && firstSeen > 0 ? firstSeen : null,
    riskLevel: 0,
    holders: 0,
    top10HolderPercent: 0,
    social: {},
    // The WS scorer proves no safety facts — never claim it audited anything.
    audited: false,
    riskKnown: false,
    discoveryEvidence: [
      {
        provider: 'dexscreener',
        category: 'TRENDING',
        discoveredAt: Number.isFinite(firstSeen) && firstSeen > 0 ? firstSeen : Date.now(),
        kinds: ['ws-hype'],
        note: `nexus-ws realtime hype score ${Number.isFinite(hypeScore) ? hypeScore : 0}/100`,
      },
    ],
  }
}

// ─────────────────────────────────────────────────────────────
// Live state (process-local rate window)
// ─────────────────────────────────────────────────────────────

let rateState = createRateLimitState()

/** Test seam: drop the in-process rate window. */
export function resetRateLimit(): void {
  rateState = createRateLimitState()
}

/** Test seam: run the scan with injected deps (zero network). */
export type ScanRunner = (token: RealtimeScoredToken) => Promise<SniperScanResult>

/**
 * Build the scan runner used in production: the WS event becomes the ONLY
 * discovery input, while audit / smart-money / delivery stay the live ones.
 *
 * `runSniperScan` owns the whole hard pipeline (audit fan-out, ebook
 * profile evaluation, tiering, seen-state dedup, Telegram delivery), so the
 * bridge never reimplements a gate — it only feeds it.
 */
function liveScanRunner(token: RealtimeScoredToken): Promise<SniperScanResult> {
  const candidate = scoredTokenToCandidate(token)
  const deps: Partial<SniperScanDeps> = { discover: async () => [candidate] }
  return runSniperScan(
    { limit: 1, deliver: true, deliveryPolicy: realtimeDeliveryPolicy() },
    deps as SniperScanDeps,
  )
}

/**
 * One realtime token event → sniper gates → (maybe) Telegram.
 *
 * Never throws: this runs on the WS event loop, where an exception would
 * take down the whole stream. Every outcome is logged and returned.
 *
 * Running the shared pipeline also picks up its own per-contract cooldown /
 * seen-state, which is what enforces SNIPER_REALTIME_COOLDOWN_MS.
 */
export async function onRealtimeToken(
  token: RealtimeScoredToken,
  run: ScanRunner = liveScanRunner,
): Promise<RealtimeBridgeResult> {
  if (!realtimeEnabled()) {
    return { enabled: false, skipped: true, reason: 'SNIPER_REALTIME_ENABLED is not true' }
  }

  const contract = (token.address ?? '').trim()
  if (!contract) {
    return { enabled: true, skipped: true, reason: 'event carried no contract' }
  }

  if (!allowEvent(rateState, Date.now(), REALTIME_WINDOW_MS, maxEventsPerMinute())) {
    return {
      enabled: true,
      skipped: true,
      reason: `rate limit: >${maxEventsPerMinute()} events/min`,
    }
  }

  let result: SniperScanResult
  try {
    result = await run(token)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[realtime-sniper] ${contract.slice(0, 8)} scan failed: ${reason}`)
    return { enabled: true, skipped: true, reason: `scan failed: ${reason}` }
  }

  // Share the operator's decision log with the cron path.
  try {
    appendSniperScan(result)
  } catch {
    /* logging is best-effort — a full disk must not break the stream */
  }

  const decision = result.decisions[0]
  const hype = Number(token.score)
  console.log(
    `[realtime-sniper] ${token.chain || 'solana'}:${contract} ` +
      `hype=${Number.isFinite(hype) ? hype : 0} ` +
      `status=${decision?.status ?? 'none'} tier=${decision?.tier ?? 'none'} ` +
      `delivered=${decision?.delivered ?? false}`,
  )

  return { enabled: true, skipped: false, result }
}
