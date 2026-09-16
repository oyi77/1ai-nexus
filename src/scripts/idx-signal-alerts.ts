// ─────────────────────────────────────────────────────────────
// IDX signal alerts — daily digest of extreme readings, delivered
// via the existing Telegram alert channel (notifyAlert; noop without
// TELEGRAM_ALERT_BOT_TOKEN/CHAT_ID).
//
// Conditions (all from nightly snapshots, evaluated post-harvest):
// - RS extremes: top-3 rsScore >= 90
// - ARA proximity: room-to-limit < 8%
// - Bandar flips: accdist Acc* with foreign accumulation streak
//
// Cron (weekdays 19:45 — after signal track):
//   45 19 * * 1-5 cd /home/openclaw/projects/1ai-tracker && npm run alert:idx-signals >> /tmp/idx-signal-alert.log 2>&1
// Honest scope: snapshot-based daily digest, NOT intraday real-time
// (intraday needs the WS tape + staged session — future work).
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { notifyAlert } from '@/lib/config/alerting'
import { getRSSignals, getARAProximity, getBandarFlowSignals } from '@/lib/modules/market/provider/idx-signals'

async function main() {
  try {
    const [rs, ara, bandar] = await Promise.all([
      getRSSignals(10).catch(() => null),
      getARAProximity(10).catch(() => null),
      getBandarFlowSignals(20).catch(() => null),
    ])
    const lines: string[] = []
    if (rs) {
      const hot = rs.items.filter(i => i.rsScore >= 90).slice(0, 3)
      for (const h of hot) {
        lines.push(`RS ${h.code} score ${h.rsScore.toFixed(0)} (+${(h.rs4w ?? 0).toFixed(1)}pp/4w)`)
      }
    }
    if (ara) {
      const near = ara.items.filter(i => i.proximityPct < 8).slice(0, 3)
      for (const n of near) {
        lines.push(`ARA ${n.code} +${n.proximityPct.toFixed(1)}% room (close ${n.close}, limit ${n.ara})`)
      }
    }
    if (bandar) {
      const flips = bandar.items
        .filter(i => /acc/i.test(i.accdist) && i.foreignStreakDir === 'accumulation')
        .slice(0, 3)
      for (const f of flips) {
        lines.push(`BANDAR ${f.code} ${f.accdist} × foreign ${f.foreignStreakDays}d`)
      }
    }
    if (lines.length === 0) {
      console.log('[signal-alert] no extreme readings today — quiet')
      return
    }
    await notifyAlert('IDX signals', lines.join('\n'))
    console.log(`[signal-alert] sent ${lines.length} lines`)
  } catch (err) {
    console.error('[signal-alert] failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  } finally {
    // Same Redis-hang guard as idx-signal-track (getCached keeps the loop alive).
    const { closeRedis } = await import('@/lib/redis')
    await closeRedis().catch(() => {})
  }
}

main()

