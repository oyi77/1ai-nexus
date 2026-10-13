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

import { runSniperScan } from '@/lib/modules/derived/sniper-scan'
import { appendSniperScan } from '@/lib/modules/derived/sniper-log'
import { DEFAULT_DELIVERY_POLICY, type DeliveryPolicy } from '@/lib/modules/derived/signal-tier'

import { pushReviewDigest } from '@/lib/modules/derived/sniper-review'
import { appendSniperAudit, materiallyChanged, accumulationReadings } from '@/lib/modules/derived/sniper-audit'
import { classifyAccumulation } from '@/lib/modules/derived/sniper-accumulation'
import {
  readOutcomes,
  writeOutcomes,
  registerDeliveries,
  sweepOutcomes,
  summariseOutcomes,
  summariseByTier,
  summariseByProfile,
  type PriceObservation,
} from '@/lib/modules/derived/sniper-outcomes'
import { calibrateTiers, demotionSummary } from '@/lib/modules/derived/tier-calibration'
import { adaptDeliveryPolicy, adaptivePolicyReason } from '@/lib/modules/derived/adaptive-policy'

/**
 * Policy D keeps WATCHLIST opt-in: it is a labelled, unconfirmed candidate,
 * never a top signal. The cron is the only production pusher, so the opt-in
 * lives here — REJECT/UNKNOWN/STALE stay undeliverable regardless (see
 * shouldDeliver).
 */
function deliveryPolicy(byTier?: Record<string, { scored: number; hitRatePct: number | null }>): DeliveryPolicy {
  const base: DeliveryPolicy = {
    ...DEFAULT_DELIVERY_POLICY,
    allowWatchlist: process.env.SNIPER_DELIVER_WATCHLIST === 'true',
  }
  if (process.env.SNIPER_ADAPTIVE_POLICY !== 'true' || byTier === undefined) return base

  const policy = adaptDeliveryPolicy({ base, byTier })
  const reason = adaptivePolicyReason({ base, byTier })
  console.log(`[sniper] adaptive policy: ${reason ?? 'no change'}`)
  return policy
}

const LIMIT = Number(process.env.SNIPER_SCAN_LIMIT) || 5
const DELIVER = process.env.SNIPER_DELIVER !== 'false'

async function main() {
  console.log(
    `[sniper] scan start (limit=${LIMIT}, deliver=${DELIVER}, watchlist=${process.env.SNIPER_DELIVER_WATCHLIST === 'true'})`,
  )
  // Adaptive policy reads PRE-EXISTING outcome history (before this pass
  // registers new, unproven signals) so adaptation reflects real evidence.
  const priorByTier = summariseByTier(readOutcomes().signals)
  const res = await runSniperScan({
    limit: LIMIT,
    deliver: DELIVER,
    deliveryPolicy: deliveryPolicy(priorByTier),
  })
  appendSniperScan(res)

  // Phase 7: compute what materially changed BEFORE persisting this pass, so
  // the label compares against real history; then open the digest for those
  // contracts even inside the seen-TTL.
  const forceReReview = materiallyChanged(res)
  appendSniperAudit(res)

  // Near-miss review digest: REJECTs with real 5m flow go to the operator's
  // private review chat, never to the sale channel. Off unless the review
  // chat is configured.
  const review = await pushReviewDigest(res.decisions, { forceContracts: forceReReview })
  if (review.sent) console.log(`[sniper] review digest sent (${review.candidates} near-miss, ${forceReReview.size} re-review)`)
  else if (review.candidates > 0) console.log(`[sniper] review digest skipped: ${review.skipped}`)

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
    // TAHAP 2: holder-tier delta across scans for THIS contract. Needs two
    // readings that both carry holder facts, so it stays quiet on a first
    // sighting rather than claiming a phase it cannot prove.
    const phase = classifyAccumulation(accumulationReadings(d.contract))
    if (phase.verdict !== 'UNKNOWN') {
      console.log(
        `[sniper]     ↳ phase=${phase.verdict} score=${phase.score} (${phase.readings} readings)${phase.reason ? ` — ${phase.reason}` : ''}`,
      )
    }
  }

  // TAHAP 4: close the loop. Every delivered signal enters the outcome log
  // with the entry market cap it was pushed at, so a later sweep can score
  // what the market actually did.
  const observedAt = new Date().toISOString()
  const prices: PriceObservation[] = res.decisions.map((d) => ({
    contract: d.contract,
    marketCapUsd: d.market.marketCapUsd,
    observedAt,
  }))
  let outcomeLog = registerDeliveries(
    readOutcomes(),
    res.decisions.map((d) => ({
      contract: d.contract,
      ticker: d.ticker,
      tier: d.tier,
      delivered: d.delivered,
      market: d.market,
      rejections: d.rejections,
      warnings: d.warnings,
    })),
    observedAt,
  )
  outcomeLog = writeOutcomes(sweepOutcomes(outcomeLog, prices))
  const stats = summariseOutcomes(outcomeLog.signals)
  if (stats.scored > 0 || stats.pending > 0) {
    const hit = stats.hitRatePct === null ? 'n/a' : `${stats.hitRatePct.toFixed(0)}%`
    const avg = stats.avgReturnPct === null ? 'n/a' : `${stats.avgReturnPct.toFixed(1)}%`
    console.log(
      `[sniper] outcomes: scored=${stats.scored} target=${stats.targets} stopped=${stats.stopped} flat=${stats.flat} pending=${stats.pending} unpriceable=${stats.unpriceable} hitRate=${hit} avgReturn=${avg}`,
    )
  }

  // TAHAP 4 (observability only): surface per-tier performance so the
  // operator can see which tiers are earning their volume. The actual
  // delivery-policy demotion is a later, operator-approved step — nothing
  // here changes what gets pushed.
  const byTier = summariseByTier(outcomeLog.signals)
  const calibrations = calibrateTiers(byTier)
  const demotions = demotionSummary(calibrations)
  if (demotions !== null) console.log(`[sniper] calibration: ${demotions}`)
  console.log(
    `[sniper] tier hit rates: ${calibrations
      .map((c) => `${c.tier}=${c.hitRatePct === null ? 'n/a' : `${c.hitRatePct.toFixed(0)}%`}(${c.scored})`)
      .join(' ')}`,
  )
  const byProfile = summariseByProfile(outcomeLog.signals)
  console.log(
    `[sniper] profile hit rates: ${Object.entries(byProfile)
      .map(([profile, s]) => `${profile}=${s.hitRatePct === null ? 'n/a' : `${s.hitRatePct.toFixed(0)}%`}(${s.scored})`)
      .join(' ')}`,
  )

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
