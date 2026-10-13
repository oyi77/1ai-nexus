// ─────────────────────────────────────────────────────────────
// KOLScan transaction signature dedup store.
//
// Persists signatures of already-processed screened KOLScan buys to
// data/kolscan-seen.json (runtime state, gitignored — same class as
// data/sniper-seen.json). A buy must only be counted/folded/notified
// once across 5-minute cron runs.
//
// Entries older than KOLSCAN_SEEN_TTL_MS (6h) are pruned on read, so a
// signature can legitimately re-enter after a long gap. A missing or
// corrupt file reads as empty — a broken state file must never brick a
// scan, and no function here throws.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { KolscanScreenedTx } from './index'

export const KOLSCAN_SEEN_TTL_MS = 6 * 60 * 60_000

function seenPath(): string {
  return process.env.KOLSCAN_SEEN_PATH || join(process.cwd(), 'data', 'kolscan-seen.json')
}

/** Read + prune the persisted signature map. Missing/corrupt → empty. */
function readSeen(): Map<string, number> {
  const out = new Map<string, number>()
  try {
    const p = seenPath()
    if (!existsSync(p)) return out
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out
    const cutoff = Date.now() - KOLSCAN_SEEN_TTL_MS
    for (const [sig, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && at >= cutoff) out.set(sig, at)
    }
  } catch {
    // corrupt/unreadable state reads as empty
  }
  return out
}

function writeSeen(map: Map<string, number>): void {
  try {
    const p = seenPath()
    mkdirSync(dirname(p), { recursive: true })
    const obj: Record<string, number> = {}
    for (const [sig, at] of map) obj[sig] = at
    writeFileSync(p, JSON.stringify(obj))
  } catch {
    // dedup state is best-effort
  }
}

/**
 * Drop transactions whose signature is already in the seen store.
 * Returns only the unseen survivors (order preserved).
 */
export function filterUnseenTransactions(txs: KolscanScreenedTx[]): KolscanScreenedTx[] {
  const seen = readSeen()
  return txs.filter((tx) => !seen.has(tx.signature))
}

/**
 * Record signatures with the current epoch ms. Prunes expired entries on
 * the read that precedes the merge, so the file stays bounded.
 */
export function markTransactionsSeen(txs: Array<Pick<KolscanScreenedTx, 'signature'>>): void {
  if (txs.length === 0) return
  const seen = readSeen()
  const now = Date.now()
  for (const tx of txs) seen.set(tx.signature, now)
  writeSeen(seen)
}
