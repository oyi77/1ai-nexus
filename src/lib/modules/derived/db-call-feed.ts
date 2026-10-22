// ─────────────────────────────────────────────────────────────
// Call-feed harvest — DB-primary read path with JSON fallback.
//
// Migrated 2026-10-16 (operator directive: prefer DB over JSON).
// `CallFeed` (PostgreSQL via Prisma) is the PRIMARY store for the
// operator call-channel harvest (was data/call-feed-latest.json).
//
// IMPORTANT — Python owns the harvester + dedup:
//   scripts/call-feed.py (Telethon) reads the operator's 12 call channels,
//   dedups via data/call-feed-state.sqlite, and writes the JSON artifact.
//   We do NOT rewrite the harvester. A TS sync step
//   (src/scripts/call-feed-sync-db.ts, npm run sync:call-feed) reads the
//   JSON artifact and upserts rows here so sniper-scan can query DB-first.
//
// Invariants (mirrors db-session-store.ts):
//   • NEVER-FAIL: every DB op is wrapped; nothing exported throws.
//   • DUAL-WRITE: the sync step writes BOTH Prisma and the JSON file
//     (the JSON file is already Python-owned, so the sync only upserts
//     into the DB — it does NOT overwrite the JSON).
//   • Reads (sniper-scan) try DB first, fall back to JSON when the DB
//     fails or has no rows while JSON has data.
//   • Kill-switch CALL_FEED_DB=off skips ALL prisma calls.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { isPlausibleSolMint } from './solana-mint'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `CALL_FEED_DB` is 'off'/'false'/'0', ALL prisma
 * calls are skipped — reads go straight to the JSON file, no errors
 * logged. Used by tests to avoid polluting the live DB.
 */
export function isCallFeedDbDisabled(): boolean {
  const v = process.env.CALL_FEED_DB
  return v === 'off' || v === 'false' || v === '0'
}

// ── Public row shape (mirrors the Python JSON artifact) ──────

export interface CallFeedRow {
  contract: string
  chain: string
  sources: string[]
  sourceCount: number
  mentions: number
  kinds: string[]
  firstSeen: string
  lastSeen: string
  weightedScore?: number
  callerWeights?: Record<string, number>
  /**
   * When this row's source artifact was produced. Set only by the JSON reader,
   * so a DB row (which has no artifact of its own) can never be judged fresher
   * than the snapshot it claims to describe.
   */
  artifactGeneratedAt?: number
}

/**
 * True for a JSON column holding group → weight. Postgres `Json?` has no
 * shape guarantee: a migrated row can hold a string, an array, or null,
 * so the map is validated before it reaches arithmetic.
 */
function isWeightMap(v: unknown): v is Record<string, number> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every(
    (w) => typeof w === 'number' && Number.isFinite(w),
  )
}

// ── JSON artifact path (Python-owned, read-only here) ────────

export function callFeedJsonPath(): string {
  return (
    process.env.CALL_FEED_PATH ??
    join(process.cwd(), 'data', 'call-feed-latest.json')
  )
}

interface CallFeedArtifact {
  generated_at: string
  window_min: number
  new_mentions?: number
  candidates: Array<Record<string, unknown>>
}

/**
 * Read the Python-owned JSON artifact directly (no DB) — the sync step's
 * source of truth. Needed because the DB-first `loadCallFeed` would hand back
 * the DB's own rows (which lack provenance on old records), making the sync
 * write empty `sources` back over good data.
 */
export function readCallFeedArtifact(
  nowMs = Date.now(),
  maxAgeMin = Number(process.env.CALL_FEED_MAX_AGE_MIN) || 180,
): CallFeedRow[] {
  return readJsonArtifact(nowMs, maxAgeMin)
}

function isSolanaChain(chain: string | null | undefined): boolean {
  return !chain || chain === 'solana'
}

function readJsonArtifact(nowMs: number, maxAgeMin: number): CallFeedRow[] {
  try {
    const p = callFeedJsonPath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8')) as CallFeedArtifact
    if (!raw || !Array.isArray(raw.candidates)) return []
    const generatedAt = Date.parse(raw.generated_at)
    if (!Number.isFinite(generatedAt)) return []
    const fresh = (ageMin: number) => ageMin <= maxAgeMin && ageMin >= -5
    if (!fresh((nowMs - generatedAt) / 60_000)) return []
    return raw.candidates
      .filter((c) => typeof c?.contract === 'string' && typeof c.source_count === 'number')
      .map((c) => ({
        contract: c.contract as string,
        chain: (c.chain as string) || 'solana',
        sources: Array.isArray(c.sources) ? (c.sources.filter((s): s is string => typeof s === 'string')) : [],
        sourceCount: c.source_count as number,
        mentions: typeof c.mentions === 'number' ? c.mentions : 0,
        kinds: Array.isArray(c.kinds) ? (c.kinds.filter((k): k is string => typeof k === 'string')) : [],
        firstSeen: typeof c.first_seen === 'string' ? c.first_seen : raw.generated_at,
        lastSeen: typeof c.last_seen === 'string' ? c.last_seen : raw.generated_at,
        artifactGeneratedAt: generatedAt,
        ...(typeof c.weighted_score === 'number' && Number.isFinite(c.weighted_score) && {
          weightedScore: c.weighted_score as number,
        }),
        ...(isWeightMap(c.caller_weights) && { callerWeights: c.caller_weights }),
      }))
      .filter((c) => c.sourceCount >= 1)
      .filter((c) => fresh((nowMs - Date.parse(c.lastSeen)) / 60_000))
  } catch {
    return []
  }
}
/**
 * Union of the DB rows and the JSON artifact, keyed by contract, preferring
 * whichever source is fresher FOR THAT ROW.
 *
 * Why not DB-only: the sync step runs on its own cadence, so a contract the
 * Python harvester just picked up is absent from the DB for up to one sync
 * interval. Returning "the DB had rows" therefore silently dropped the newest
 * calls. Why not JSON-only: the artifact is rewritten on every harvest, so a
 * burst that scrolls out of its window disappears from the file while the DB
 * still holds the row (and its caller weights) for `maxAgeMin`.
 *
 * Every contract comes from exactly one winning source. The winner's own
 * fields are used whole — mixing one source's mention count with another's
 * `lastSeen` would describe a contract nobody observed.
 */
export function mergeCallFeedRows(fromDb: CallFeedRow[], fromArtifact: CallFeedRow[]): CallFeedRow[] {
  const merged = new Map<string, CallFeedRow>()
  for (const row of [...fromDb, ...fromArtifact]) {
    const kept = merged.get(row.contract)
    if (!kept || Date.parse(row.lastSeen) > Date.parse(kept.lastSeen)) merged.set(row.contract, row)
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
}

// ── Public API ───────────────────────────────────────────────

/**
 * Upsert call-feed rows into the DB by contract. Called by the TS sync
 * step (call-feed-sync-db.ts) after Python writes the JSON artifact.
 * Does NOT overwrite the JSON (Python owns it). Never throws.
 */
export async function saveCallFeedRows(rows: CallFeedRow[]): Promise<void> {
  if (isCallFeedDbDisabled() || rows.length === 0) return
  try {
    for (const row of rows) {
      const lastSeenAt = Number.isFinite(Date.parse(row.lastSeen))
        ? new Date(row.lastSeen)
        : new Date()
      await prisma.callFeed.upsert({
        where: { contract: row.contract },
        create: {
          contract: row.contract,
          chain: row.chain || 'solana',
          ticker: '',
          marketCapUsd: null,
          mentionCount: row.mentions,
          sources: row.sources,
          kinds: row.kinds,
          weightedScore: row.weightedScore ?? null,
          callerWeights: row.callerWeights ?? undefined,
          lastSeenAt,
        },
        update: {
          chain: row.chain || 'solana',
          mentionCount: row.mentions,
          // Provenance is the whole point of the call-feed: "which group
          // called this CA". Dropping it here made the DB-first read return
          // sources:[] and sourceCount=mentionCount.
          sources: row.sources,
          kinds: row.kinds,
          weightedScore: row.weightedScore ?? null,
          callerWeights: row.callerWeights ?? undefined,
          lastSeenAt,
        },
      })
    }
  } catch (err) {
    console.error(`[db-call-feed] DB upsert failed: ${errorMessage(err)}`)
  }
}

/**
 * Load call-feed candidates: the DB rows UNION the JSON artifact, freshest
 * row wins per contract. Merging (rather than DB-shadows-JSON) is required
 * because the sync step lags the harvester by up to one interval — a
 * DB-only read dropped every call made since the last sync. Staleness is
 * still enforced: DB rows older than `maxAgeMin` are never queried, and the
 * artifact reader drops its own stale rows. Never throws.
 *
 * NOTE: sources / kinds / weightedScore / callerWeights are all persisted
 * (callerWeights added 2026-10-22 so the DB path can weight groups by origin
 * rate exactly as the JSON artifact does).
 */
export async function loadCallFeed(
  nowMs = Date.now(),
  maxAgeMin = Number(process.env.CALL_FEED_MAX_AGE_MIN) || 180,
): Promise<CallFeedRow[]> {
  if (isCallFeedDbDisabled()) return readJsonArtifact(nowMs, maxAgeMin)
  try {
    const cutoff = new Date(nowMs - maxAgeMin * 60_000)
    const dbRows = await prisma.callFeed.findMany({
      where: { lastSeenAt: { gte: cutoff } },
      orderBy: { lastSeenAt: 'desc' },
    })
    // Rows written before the 2026-10-22 extractor fix can carry a contract
    // that is not a mint at all (a `%3A` escape tail welded onto a real
    // mint). A scanner handed one of those burns an audit on a token that
    // does not exist, so they are dropped at the boundary rather than
    // trusted because they happen to be fresh.
    const usable = dbRows
      .filter((r) => !isSolanaChain(r.chain) || isPlausibleSolMint(r.contract))
      .map((r) => ({
        contract: r.contract,
        chain: r.chain,
        sources: r.sources,
        // sourceCount is GROUPS, not mentions: the rows where an old record
        // stored no provenance fall back to 1 (the row exists, so at least
        // one group saw it) rather than inflating to the mention count.
        sourceCount: r.sources.length > 0 ? r.sources.length : 1,
        mentions: r.mentionCount,
        kinds: r.kinds,
        firstSeen: r.lastSeenAt.toISOString(),
        lastSeen: r.lastSeenAt.toISOString(),
        ...(r.weightedScore !== null && { weightedScore: r.weightedScore }),
        ...(isWeightMap(r.callerWeights) && { callerWeights: r.callerWeights }),
      }))
    return mergeCallFeedRows(usable, readJsonArtifact(nowMs, maxAgeMin))
  } catch (err) {
    console.error(`[db-call-feed] DB read failed: ${errorMessage(err)}`)
    return readJsonArtifact(nowMs, maxAgeMin)
  }
}

/**
 * Delete all rows older than `maxAgeMin`. Returns the deleted count, or -1
 * when the DB is unreachable. Never throws.
 */
export async function pruneStaleCallFeed(maxAgeMin = 180): Promise<number> {
  if (isCallFeedDbDisabled()) return -1
  try {
    const cutoff = new Date(Date.now() - maxAgeMin * 60_000)
    const res = await prisma.callFeed.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    })
    return res.count
  } catch (err) {
    console.error(`[db-call-feed] prune failed: ${errorMessage(err)}`)
    return -1
  }
}
