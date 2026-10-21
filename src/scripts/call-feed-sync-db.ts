#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Call-feed DB sync step.
//
// Python (scripts/call-feed.py) owns the Telethon harvester + the
// SQLite dedup (data/call-feed-state.sqlite) and writes the JSON
// artifact (data/call-feed-latest.json). This script reads that artifact
// and upserts rows into the `CallFeed` Prisma table so sniper-scan can
// query DB-first instead of reading the file directly.
//
// The JSON artifact is NOT overwritten — Python owns it. This script only
// upserts into Postgres. Run it right after call-feed.py in crontab
// (offset by ~45s so the Python write has landed).
//
// Run: npm run sync:call-feed
// Env: CALL_FEED_PATH (default data/call-feed-latest.json)
//      CALL_FEED_DB   (kill-switch: off/false/0 skips all DB writes)
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import {
  saveCallFeedRows,
  readCallFeedArtifact,
  loadCallFeed,
  pruneStaleCallFeed,
  type CallFeedRow,
} from '@/lib/modules/derived/db-call-feed'

async function main(): Promise<void> {
  if (process.env.CALL_FEED_DB === 'off' || process.env.CALL_FEED_DB === 'false' || process.env.CALL_FEED_DB === '0') {
    console.log('[call-feed-sync] CALL_FEED_DB disabled — skipping')
    return
  }

  const nowMs = Date.now()
  const maxAgeMin = Number(process.env.CALL_FEED_MAX_AGE_MIN) || 180

  // Read the ARTIFACT, not loadCallFeed: the latter is DB-first and would
  // return the DB's own (possibly provenance-less) rows, writing empty
  // sources back over good data. Python owns the artifact; this is its reader.
  const rows: CallFeedRow[] = readCallFeedArtifact(nowMs, maxAgeMin)
  if (rows.length === 0) {
    console.log('[call-feed-sync] no candidates in artifact (stale or empty) — nothing to sync')
  } else {
    console.log(`[call-feed-sync] syncing ${rows.length} candidate(s) from JSON → DB`)
    await saveCallFeedRows(rows)
  }

  // Upsert-only left every row ever seen in the table (2,721 rows spanning a
  // week, all past the read window). The delete runs even on an empty
  // artifact — otherwise a stalled harvester freezes the stale set in place
  // and DB-first reads keep serving week-old groups.
  const pruned = await pruneStaleCallFeed(maxAgeMin)
  if (pruned > 0) {
    console.log(`[call-feed-sync] pruned ${pruned} stale row(s)`)
  }

  // Verify: read back from DB to confirm the upserts landed.
  const dbRows = await loadCallFeed(nowMs, maxAgeMin)
  console.log(`[call-feed-sync] done: DB now has ${dbRows.length} call-feed row(s)`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[call-feed-sync] FATAL:', err)
    process.exit(1)
  })
