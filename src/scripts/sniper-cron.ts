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
// Cron: */5 * * * * (every 5 min) — pairs are short-lived, so a
// tight cadence matters more than depth; the seen-TTL prevents repeat
// pushes for the same contract.
//
// Run: npm run cron:sniper
// -------------------------------------------------------------

import { runSniperScan } from '@/lib/modules/derived/sniper-scan'
import { saveScanDecisions, saveAuditEntries, loadOutcomeLog, saveOutcomes } from '@/lib/modules/derived/db-stores'
import {
  registerDeliveries,
  sweepOutcomes,
  summariseOutcomes,
  summariseByTier,
  summariseByProfile,
  type PriceObservation,
} from '@/lib/modules/derived/sniper-outcomes'
import { DEFAULT_DELIVERY_POLICY, type DeliveryPolicy } from '@/lib/modules/derived/signal-tier'

import { pushReviewDigest } from '@/lib/modules/derived/sniper-review'
import { buildAuditEntries, materiallyChanged } from '@/lib/modules/derived/sniper-audit'
import { persistAccumulationPhases } from '@/lib/modules/derived/sniper-phase'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'
import { escapeSignalHtml } from '@/lib/modules/derived/signal-tier'
import { calibrateTiers, demotionSummary } from '@/lib/modules/derived/tier-calibration'
import { resolveAdaptivePolicy } from '@/lib/modules/derived/adaptive-policy'

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
  if (byTier === undefined) return base

  const mode =
    process.env.SNIPER_ADAPTIVE_POLICY === 'true'
      ? 'on'
      : process.env.SNIPER_ADAPTIVE_POLICY_DRY_RUN === 'true'
        ? 'dry-run'
        : 'off'
  if (mode === 'off') return base

  const resolved = resolveAdaptivePolicy(base, byTier, mode)
  if (mode === 'dry-run') {
    console.log(`[sniper] adaptive policy (dry-run): ${resolved.reason ?? 'no change'}`)
  } else {
    console.log(`[sniper] adaptive policy: ${resolved.reason ?? 'no change'}`)
  }
  return resolved.policy
}

const LIMIT = Number(process.env.SNIPER_SCAN_LIMIT) || 5
const DELIVER = process.env.SNIPER_DELIVER !== 'false'

async function main() {
  console.log(
    `[sniper] scan start (limit=${LIMIT}, deliver=${DELIVER}, watchlist=${process.env.SNIPER_DELIVER_WATCHLIST === 'true'})`,
  )
  // Adaptive policy reads PRE-EXISTING outcome history (before this pass
  // registers new, unproven signals) so adaptation reflects real evidence.
  const priorOutcomeLog = await loadOutcomeLog()
  const priorByTier = summariseByTier(priorOutcomeLog.signals)
  const res = await runSniperScan({
    limit: LIMIT,
    deliver: DELIVER,
    deliveryPolicy: deliveryPolicy(priorByTier),
  })
  await saveScanDecisions(res.decisions, res)

  // Phase 7: compute what materially changed BEFORE persisting this pass, so
  // the label compares against real history; then open the digest for those
  // contracts even inside the seen-TTL.
  const forceReReview = materiallyChanged(res)
  await saveAuditEntries(buildAuditEntries(res))
  // Near-miss review digest: REJECTs with real 5m flow go to the operator's
  // private review chat, never to the sale channel. Off unless the review
  // chat is configured.
  const review = await pushReviewDigest(res.decisions, { forceContracts: forceReReview })
  if (review.sent) console.log(`[sniper] review digest sent (${review.candidates} near-miss, ${forceReReview.size} re-review)`)
  else if (review.candidates > 0) console.log(`[sniper] review digest skipped: ${review.skipped}`)

  // TAHAP 2: classify each contract's holder-tier phase and persist it
  // (previously stdout-only). Non-UNKNOWN verdicts are appended to
  // data/sniper-phase.json; ACCUMULATION verdicts that pass the cooldown
  // gate are also sent to the operator's review chat.
  const phaseResult = persistAccumulationPhases(res.decisions)
  const phaseByContract = new Map(phaseResult.phases.map((p) => [p.contract, p]))

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
    const phase = phaseByContract.get(d.contract)?.phase
    if (phase !== undefined && phase.verdict !== 'UNKNOWN') {
      console.log(
        `[sniper]     ↳ phase=${phase.verdict} score=${phase.score} (${phase.readings} readings)${phase.reason ? ` — ${phase.reason}` : ''}`,
      )
    }
  }

  for (const p of phaseResult.alerts) {
    const phase = p.phase
    const evidence = phase.evidence.length > 0 ? `\n• ${phase.evidence.map(escapeSignalHtml).join('\n• ')}` : ''
    const text =
      `📈 <b>ACCUMULATION PHASE</b>\n` +
      `${escapeSignalHtml(p.ticker)} (${p.contract})\n` +
      `Skor: ${phase.score}/100 (${phase.readings} readings)${evidence}`
    const chat =
      process.env.SNIPER_REVIEW_CHAT_ID ||
      process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
      process.env.TELEGRAM_ADMIN_CHAT_ID ||
      ''
    if (chat) {
      const sent = await deliverSniperAlert(text, chat)
      console.log(`[sniper] accumulation alert for ${p.ticker}: ${sent ? 'sent' : 'rejected/unconfigured'}`)
    } else {
      console.log(`[sniper] accumulation alert for ${p.ticker}: skipped (no review chat configured)`)
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
    await loadOutcomeLog(),
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
  outcomeLog = sweepOutcomes(outcomeLog, prices)
  await saveOutcomes(outcomeLog)
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
