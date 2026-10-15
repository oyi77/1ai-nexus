// ─────────────────────────────────────────────────────────────
// Sniper scan — seen-state: contract + ticker dedup.
// Carved verbatim from sniper-scan.ts for the 800-line gate.
// ─────────────────────────────────────────────────────────────

import {
  candidateKey,
} from '@/lib/modules/derived/unified-candidate'
import {
  markScanSeen as markScanSeenDb,
  markTickerSeen as markTickerSeenDb,
} from '@/lib/modules/derived/db-seen-store'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

function seenTtlMs(): number {
  return Number(process.env.SNIPER_SEEN_TTL_MS) || 60 * 60_000
}

function seenPath(): string {
  return process.env.SNIPER_SEEN_PATH || join(process.cwd(), 'data', 'sniper-seen.json')
}

export function readSeenState(): Record<string, number> {
  try {
    const p = seenPath()
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, number>
    const cutoff = Date.now() - seenTtlMs()
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) if (v >= cutoff) out[k] = v
    return out
  } catch {
    return {}
  }
}

export function markSeenState(map: Record<string, number>): void {
  try {
    const p = seenPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(map))
  } catch { /* dedupe state is best-effort */ }
}
/**
 * Dual-write a scan key to DB + the JSON backup map. The JSON update stays
 * in the caller's map so `markSeenState` persists everything once per pass.
 */
export async function trackScanSeen(map: Record<string, number>, chain: string, contract: string): Promise<void> {
  map[candidateKey(chain, contract)] = Date.now()
  await markScanSeenDb(chain, contract)
}

/**
 * Dual-write a delivered ticker to DB + the JSON backup map. Never throws.
 */
export async function trackTickerSeen(map: Record<string, number>, chain: string, normalizedTicker: string): Promise<void> {
  markTickerSeen(map, normalizedTicker)
  if (normalizedTicker.length === 0) return
  await markTickerSeenDb(chain, normalizedTicker)
}

// ─────────────────────────────────────────────────────────────
// Ticker-level seen state — suppresses delivery of copycat mints
// that re-launch under the same normalized ticker but a different
// contract within the seen-TTL. Stored alongside contract keys in
// the same sniper-seen.json file under a `ticker:` prefix so there
// is no second file to manage or drift out of sync.
// ─────────────────────────────────────────────────────────────

const TICKER_SEEN_PREFIX = 'ticker:'

/**
 * Read the ticker-level seen map from the same seen-state file.
 * Keys are `ticker:<normalizedTicker>`, values are timestamps.
 * Pure read — does not mutate the file.
 */
export function readTickerSeenState(): Record<string, number> {
  const seen = readSeenState()
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(seen)) {
    if (k.startsWith(TICKER_SEEN_PREFIX)) {
      out[k.slice(TICKER_SEEN_PREFIX.length)] = v
    }
  }
  return out
}

/**
 * Mark a normalized ticker as seen in the shared seen-state map.
 * Mutates `map` in place — caller persists via `markSeenState`.
 */
export function markTickerSeen(map: Record<string, number>, normalizedTicker: string): void {
  if (normalizedTicker.length === 0) return
  map[`${TICKER_SEEN_PREFIX}${normalizedTicker}`] = Date.now()
}

/**
 * Check whether a normalized ticker was seen under a DIFFERENT contract
 * within the TTL. Returns the timestamp if a prior delivery happened
 * under a different contract, or `null` if not suppressed.
 *
 * `currentContract` is the contract being evaluated now; if the ticker
 * was seen but the key matches this exact contract, re-evaluation is
 * allowed (the contract itself is just re-evaluated, not a copycat).
 */
export function tickerSeenUnderDifferentContract(
  seen: Record<string, number>,
  normalizedTicker: string,
  chain: string,
  contract: string,
): number | null {
  if (normalizedTicker.length === 0) return null
  const tickerKey = `${TICKER_SEEN_PREFIX}${normalizedTicker}`
  const ts = seen[tickerKey]
  if (ts === undefined) return null
  // The ticker was delivered before. If THIS exact contract is already
  // in seen state it is a re-evaluation of the same mint (contract-level
  // dedup owns that case) — not a copycat. Only suppress when the ticker
  // belongs to a different, un-seen contract.
  if (seen[candidateKey(chain, contract)] !== undefined) return null
  return ts
}
