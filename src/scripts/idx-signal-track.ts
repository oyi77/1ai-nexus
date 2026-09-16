// ─────────────────────────────────────────────────────────────
// IDX signal track recorder — persists daily RS/breakout/ARA picks
// into AlphaTrackRecord with lanes rs|breakout|ara (no schema change:
// lane is a plain string, unique is code+date+lane).
// The existing evaluator fills 7/14/30/60d outcomes generically;
// track-record route serves per-lane stats.
//
// Cron (weekdays 19:30 — after harvests):
//   30 19 * * 1-5 cd /home/openclaw/projects/1ai-tracker && npm run track:idx-signals >> /tmp/idx-signal-track.log 2>&1
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { prisma } from '@/lib/db'
import { notifyAlert } from '@/lib/config/alerting'
import { getRSSignals, getBreakoutSignals, getARAProximity } from '@/lib/modules/market/provider/idx-signals'
import { recordAlphaSignals } from '@/lib/conviction/alpha-track-record'

const TOP_N = 20

interface TrackRow {
  code: string
  sector: string
  alphaScore: number
  verdict: string
  price: number
  reasons: string[]
  lane: string
}

async function main() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const [rs, bo, ara] = await Promise.all([
      getRSSignals(TOP_N),
      getBreakoutSignals(5, TOP_N),
      getARAProximity(TOP_N),
    ])

    const sectorByCode = new Map<string, string>()
    try {
      const snap = await prisma.idxScreenerSnapshot.findFirst({
        orderBy: { snapshotDate: 'desc' },
        select: { snapshotDate: true },
      })
      if (snap) {
        const rows = await prisma.idxScreenerSnapshot.findMany({
          where: { snapshotDate: snap.snapshotDate },
          select: { code: true, sector: true },
        })
        for (const r of rows) sectorByCode.set(r.code, r.sector || 'Unknown')
      }
    } catch {
      // sector enrichment best-effort only
    }

    const priceByCode = new Map<string, number>()
    try {
      const latest = await prisma.idxSahamSession.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (latest) {
        const rows = await prisma.idxSahamSession.findMany({
          where: { tradeDate: latest.tradeDate },
          select: { code: true, close: true },
        })
        for (const r of rows) priceByCode.set(r.code, r.close)
      }
    } catch {
      // price best-effort; recorder skips rows without price below
    }

    const signals: TrackRow[] = []
    for (const r of rs.items) {
      const price = priceByCode.get(r.code)
      if (price === undefined) continue
      signals.push({
        code: r.code,
        sector: sectorByCode.get(r.code) ?? 'Unknown',
        alphaScore: Math.round(r.rsScore),
        verdict: 'buy',
        price,
        reasons: [`RS +${(r.rs4w ?? 0).toFixed(1)}pp/4w vs universe`],
        lane: 'rs',
      })
    }
    for (const b of bo.items) {
      const price = priceByCode.get(b.code)
      if (price === undefined) continue
      signals.push({
        code: b.code,
        sector: sectorByCode.get(b.code) ?? 'Unknown',
        alphaScore: Math.round(100 + b.distancePct),
        verdict: 'buy',
        price,
        reasons: [`${b.distancePct.toFixed(2)}% below 52w high ${b.high52w}`],
        lane: 'breakout',
      })
    }
    for (const a of ara.items) {
      const price = priceByCode.get(a.code)
      if (price === undefined) continue
      signals.push({
        code: a.code,
        sector: sectorByCode.get(a.code) ?? 'Unknown',
        alphaScore: Math.round(Math.max(0, Math.min(100, 100 - a.proximityPct * 5))),
        verdict: 'buy',
        price,
        reasons: [`+${a.proximityPct.toFixed(1)}% room to ARA ${a.ara}`],
        lane: 'ara',
      })
    }

    const recorded = await recordAlphaSignals(signals)
    console.log(`[signal-track] recorded ${recorded} signals (${today}): rs/breakout/ara lanes`)
  } catch (err) {
    console.error('[signal-track] failed:', err instanceof Error ? err.message : err)
    await notifyAlert('IDX signal track failed', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  } finally {
    // getCached opens the shared Redis client (fire-and-forget writes keep
    // the event loop alive) — close it or tsx never exits (hung 10+ min live).
    const { closeRedis } = await import('@/lib/redis')
    await closeRedis().catch(() => {})
    await prisma.$disconnect()
  }
}

main()
