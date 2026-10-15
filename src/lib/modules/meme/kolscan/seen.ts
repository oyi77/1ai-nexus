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
import { filterUnseenSignatures, markSignaturesSeen } from '@/lib/modules/derived/db-seen-store'

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
 * Synchronous JSON-backed dedup (backwards compatible): drop transactions
 * whose signature is already in data/kolscan-seen.json. Pure sync callers
 * and unit tests use this; the DB-first path lives in
 * `filterUnseenTransactionsDb` / `markTransactionsSeenDb`.
 */
export function filterUnseenTransactions(txs: KolscanScreenedTx[]): KolscanScreenedTx[] {
  const seen = readSeen()
  return txs.filter((tx) => !seen.has(tx.signature))
}

/**
 * DB-first filter: consults SniperReviewSeen (`kolscan:<signature>`) and
 * unions with the JSON backup, so a signature marked on a previous run —
 * whether the DB or only the JSON caught it — still dedupes. Never throws;
 * on DB failure degrades to the synchronous JSON filter.
 */
export async function filterUnseenTransactionsDb(txs: KolscanScreenedTx[]): Promise<KolscanScreenedTx[]> {
  if (txs.length === 0) return []
  const jsonSeen = readSeen()
  let dbFiltered: string[]
  try {
    dbFiltered = await filterUnseenSignatures(txs.map((tx) => tx.signature))
  } catch {
    return txs.filter((tx) => !jsonSeen.has(tx.signature))
  }
  const dbUnseen = new Set(dbFiltered.map((key) => key.slice('kolscan:'.length)))
  return txs.filter((tx) => dbUnseen.has(tx.signature) && !jsonSeen.has(tx.signature))
}

/**
 * Synchronous JSON-backed marker (backwards compatible): record signatures
 * with the current epoch ms. Pure sync callers and unit tests use this;
 * the DB-first path lives in `markTransactionsSeenDb` below.
 */
export function markTransactionsSeen(txs: Array<Pick<KolscanScreenedTx, 'signature'>>): void {
  if (txs.length === 0) return
  const seen = readSeen()
  const now = Date.now()
  for (const tx of txs) seen.set(tx.signature, now)
  writeSeen(seen)
}

/**
 * DB-first marker: dual-writes to SniperReviewSeen (`kolscan:<signature>`)
 * AND the JSON backup via `markSignaturesSeen`. Never throws — callers can
 * await it for the cron receipt (proves DB persistence before folding).
 */
export async function markTransactionsSeenDb(txs: Array<Pick<KolscanScreenedTx, 'signature'>>): Promise<void> {
  if (txs.length === 0) return
  markTransactionsSeen(txs)
  await markSignaturesSeen(txs.map((tx) => tx.signature))
}
