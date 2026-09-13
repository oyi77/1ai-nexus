#!/usr/bin/env node
// -------------------------------------------------------------
// Feed health cron:
//   1. Validate every configured RSS feed (reachability + item count)
//   2. Detect markup leaks in a sample of feeds
//   3. Compare against previous run; alert on new failures
//   4. Log stats
//
// Cron: 0 6 * * * (daily)
// -------------------------------------------------------------
import 'dotenv/config'
import { checkAllFeeds, checkFeedMarkup } from '@/lib/feed-health'
import { prisma } from '@/lib/db'
import { sendTelegramAlert } from '@/lib/telegram/bot'

const ADMIN_CHAT = process.env.FEED_ALERT_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || ''
const DATA_DIR = process.cwd() + '/data'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
mkdirSync(DATA_DIR, { recursive: true })
const PREV_PATH = DATA_DIR + '/feed-health-prev.json'

interface PrevReport { working: number; failedIds: string[] }

function readPrev(): PrevReport | null {
  try { return JSON.parse(readFileSync(PREV_PATH, 'utf8')) } catch { return null }
}
function writePrev(r: { working: number; failedIds: string[] }) {
  writeFileSync(PREV_PATH, JSON.stringify(r, null, 2))
}

async function main() {
  console.log('[feed-health] checking feeds...')
  const report = await checkAllFeeds()
  const prev = readPrev()

  // Markup leak spot-check on up to 6 feeds
  const sample = report.feeds.filter((f: { ok: boolean }) => f.ok).slice(0, 6)
  let leaks = 0
  for (const f of sample) {
    const r = await checkFeedMarkup(f.url)
    if (r.leaking > 0) leaks++
  }

  const failedIds = report.feeds.filter((f) => !f.ok).map((f: { id: string }) => f.id)
  const newFailures = prev ? failedIds.filter((id: string) => !prev.failedIds.includes(id)) : []

  console.log(`[feed-health] ${report.working}/${report.total} working, ${report.atomOnly} atom-only, ${report.dead} dead, ${leaks} leaking markup`)
  if (newFailures.length) console.log(`[feed-health] NEW failures: ${newFailures.join(', ')}`)

  // Persist a health row if the schema has one (best-effort)
  try {
    await prisma.$executeRaw`INSERT INTO feed_health (checked_at, working, dead, leaks) VALUES (now(), ${report.working}, ${report.dead}, ${leaks})`
  } catch {
    // table may not exist; health is still logged to stdout + prev file
  }

  writePrev({ working: report.working, failedIds })

  // Alert on new failures
  if (newFailures.length && ADMIN_CHAT) {
    await sendTelegramAlert(ADMIN_CHAT, `⚠️ Feed health: ${newFailures.length} new failure(s): ${newFailures.join(', ')}. ${report.working}/${report.total} still working.`)
  }
  if (leaks > 0 && ADMIN_CHAT) {
    await sendTelegramAlert(ADMIN_CHAT, `⚠️ Feed markup leak detected in ${leaks} source(s). Run feed audit.`)
  }

  // Exit non-zero if >25% of feeds are down (for cron monitoring)
  if (report.dead > report.total * 0.25) {
    console.error(`[feed-health] CRITICAL: ${report.dead}/${report.total} feeds down`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('[feed-health] failed:', e); process.exit(1) })
