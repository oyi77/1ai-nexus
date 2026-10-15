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
import { saveCallFeedRows, loadCallFeed, type CallFeedRow } from '@/lib/modules/derived/db-call-feed'

async function main(): Promise<void> {
  if (process.env.CALL_FEED_DB === 'off' || process.env.CALL_FEED_DB === 'false' || process.env.CALL_FEED_DB === '0') {
    console.log('[call-feed-sync] CALL_FEED_DB disabled — skipping')
    return
  }

  const nowMs = Date.now()
  const maxAgeMin = Number(process.env.CALL_FEED_MAX_AGE_MIN) || 180

  // loadCallFeed reads the JSON artifact (DB-first, but the DB is empty on
  // first run; the JSON fallback is the source of truth here). We pass a
  // fresh nowMs and the configured maxAge so stale artifacts return [].
  const rows: CallFeedRow[] = await loadCallFeed(nowMs, maxAgeMin)
  if (rows.length === 0) {
    console.log('[call-feed-sync] no candidates in artifact (stale or empty) — nothing to sync')
    return
  }

  console.log(`[call-feed-sync] syncing ${rows.length} candidate(s) from JSON → DB`)
  await saveCallFeedRows(rows)

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
