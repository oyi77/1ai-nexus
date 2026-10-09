#!/usr/bin/env node
// -------------------------------------------------------------
// Meme sniper cron: one live scan pass, delivering actionable legs.
//   1. Discover young dexscreener pairs (boosts + volume.m5)
//   2. Fan out rugcheck/birdeye/gmgn audits per contract
//   3. Evaluate → EXECUTE / WATCHLIST / REJECT (unproven = REJECT)
//   4. Push non-REJECT alerts to Telegram (deduped within the seen TTL)
//   5. Log stats; exit non-zero when the scan itself broke
//
// Cron: */10 * * * * (every 10 min) — pairs are short-lived, so a
// tight cadence matters more than depth; the seen-TTL prevents repeat
// pushes for the same contract.
//
// Run: npm run cron:sniper
// -------------------------------------------------------------

import 'dotenv/config'
import { runSniperScan } from '@/lib/modules/derived/sniper-scan'
import { appendSniperScan } from '@/lib/modules/derived/sniper-log'

const LIMIT = Number(process.env.SNIPER_SCAN_LIMIT) || 5
const DELIVER = process.env.SNIPER_DELIVER !== 'false'

async function main() {
  console.log(`[sniper] scan start (limit=${LIMIT}, deliver=${DELIVER})`)
  const res = await runSniperScan({ limit: LIMIT, deliver: DELIVER })
  appendSniperScan(res)

  console.log(
    `[sniper] scanned=${res.scanned} execute=${res.executed} watchlist=${res.watchlisted} ` +
      `reject=${res.rejected} deduped=${res.deduped} delivered=${res.delivered}`,
  )
  for (const d of res.decisions) {
    const why = d.status === 'REJECT' ? `${d.rejections.length} breach(es)` : 'actionable'
    console.log(
      `[sniper]   ${d.ticker} ${d.status} (${why}) vol/mc=${d.metrics.volMcRatio.toFixed(2)} age=${d.metrics.ageLabel} audits=[${d.auditsUsed.join(',')}]${d.delivered ? ' → PUSHED' : ''}${d.deduped ? ' (seen)' : ''}`,
    )
  }
  if (res.errors.length > 0) {
    for (const e of res.errors) console.error(`[sniper] error: ${e}`)
  }

  // A discovery failure that produced nothing is a real outage.
  if (res.scanned === 0 && res.errors.length > 0) {
    console.error('[sniper] CRITICAL: scan produced no candidates')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[sniper] failed:', e)
  process.exit(1)
})
