#!/usr/bin/env node
// -------------------------------------------------------------
// Meme sniper cron: one live scan pass, delivering actionable legs.
//   1. Discover young dexscreener pairs (boosts + volume.m5)
//   2. Fan out rugcheck/birdeye/gmgn audits per contract
//   3. Evaluate → EXECUTE / WATCHLIST / REJECT (unproven = REJECT)
//   4. Tier (policy D): only HIGH_CONVICTION is delivered as a top signal;
//      a clean screen without verified smart-money confirmation is withheld
//   5. Push deliverable tiers to Telegram (deduped within the seen TTL)
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

  const topSignals = res.decisions.filter((d) => d.tier === 'HIGH_CONVICTION').length
  console.log(
    `[sniper] scanned=${res.scanned} signal=${res.screened} watchlist=${res.watchlisted} ` +
      `reject=${res.rejected} deduped=${res.deduped} delivered=${res.delivered} top=${topSignals}`,
  )
  for (const d of res.decisions) {
    const why = d.status === 'REJECT' ? `${d.rejections.length} breach(es)` : 'actionable'
    const money = d.smartMoneyBuyers > 0 ? ` sm=${d.smartMoneyBuyers}(${d.smartMoneyStrongest})` : ' sm=none'
    const gap = d.tierMissing.length > 0 ? ` missing=[${d.tierMissing.join('; ')}]` : ''
    console.log(
      `[sniper]   ${d.ticker} ${d.status} ${d.tier} (${why}) vol/mc=${d.metrics.volMcRatio.toFixed(2)} age=${d.metrics.ageLabel} audits=[${d.auditsUsed.join(',')}]${money}${gap}${d.delivered ? ' → PUSHED' : ''}${d.deduped ? ' (seen)' : ''}`,
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
