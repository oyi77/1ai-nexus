// ─────────────────────────────────────────────────────────────
// IDX Stockbit Harvester — nightly bandar snapshots + guru screens +
// analyst ratings from the authed Stockbit exodus API.
//
// Auth: STOCKBIT_REFRESH_TOKEN env (or data/stockbit-session.json).
// Access JWTs auto-rotate + persist single-writer (this cron).
// polite: 400ms between symbols, top-60 by marketCap default.
// Units: blot=lots, bval=IDR (verified arithmetically 2026-09-16).
//
// Cron (weekdays 19:15 — after Ajaib harvest):
//   15 19 * * 1-5 cd /home/openclaw/projects/1ai-tracker && npm run harvest:idx-stockbit >> /tmp/idx-stockbit.log 2>&1
// Writes: IdxBandarSnapshot, IdxStockbitGuru, IdxStockbitAnalyst.
// FLAGS: --bandar-only (skip guru+analyst), --guru-only,
//   --analyst-only, --limit=N (cap symbols, default 60),
//   --templates=2,5,6 (guru preset ids, default Fisher+Piotroski+Greenblatt).
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { prisma } from '@/lib/db'
import { notifyAlert } from '@/lib/config/alerting'
import {
  fetchBandarSummary,
  fetchDistribution,
  fetchGuruRun,
  fetchAnalyst,
  fetchStreamPosts,
  stockbitAvailable,
} from '@/lib/modules/market/provider/idx-stockbit/client'

const DELAY_MS = 400
const DEFAULT_LIMIT = 60
const DEFAULT_TEMPLATES = [2, 6, 17] // Fisher P/S, Greenblatt Magic Formula, Piotroski High F-Score

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const args = new Set(process.argv.slice(2))
  const limitArg = process.argv.find(a => a.startsWith('--limit='))?.slice('--limit='.length)
  const tplArg = process.argv.find(a => a.startsWith('--templates='))?.slice('--templates='.length)
  try {
    if (!stockbitAvailable()) {
      // Not a failure: operator has not opted in (no refresh token staged).
      // Exit 0 silently-ish so cron stays green; the route already serves
      // 503 with staging instructions, which is the visible signal.
      console.log('[idx-stockbit] skip: no session staged (set STOCKBIT_REFRESH_TOKEN to enable)')
      return
    }
    const snapshotDate = new Date().toISOString().slice(0, 10)
    const onlyBandar = args.has('--bandar-only')
    const onlyGuru = args.has('--guru-only')
    const onlyAnalyst = args.has('--analyst-only')
    const runAll = !onlyBandar && !onlyGuru && !onlyAnalyst

    // Universe ranking: top-N by marketCap from our own fundamentals snapshot.
    const limit = Math.min(limitArg ? Number(limitArg) : DEFAULT_LIMIT, 500)
    const funds = await prisma.idxFundamentals.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 1,
      select: { snapshotDate: true },
    })
    const fundDate = funds[0]?.snapshotDate
    const fundRows = fundDate
      ? await prisma.idxFundamentals.findMany({ where: { snapshotDate: fundDate } })
      : []
    const codes = [...fundRows]
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, limit)
      .map(r => r.code)

    let bandarCount = 0
    if (runAll || onlyBandar) {
      for (const code of codes) {
        try {
          const summary = await fetchBandarSummary(code)
          if (!summary || !summary.tradeDate) continue
          const matrix = await fetchDistribution(code)
          await sleep(DELAY_MS)
          const m = matrix?.topBuyer
          await prisma.idxBandarSnapshot.upsert({
            where: { code_tradeDate: { code, tradeDate: summary.tradeDate } },
            create: {
              code,
              tradeDate: summary.tradeDate,
              accdist: summary.accdist,
              avgAmount: summary.levels.avg?.amount,
              avgPct: summary.levels.avg?.pct,
              top1Amount: summary.levels.top1?.amount,
              top3Amount: summary.levels.top3?.amount,
              top5Amount: summary.levels.top5?.amount,
              top10Amount: summary.levels.top10?.amount,
              buyCount: summary.buyCount,
              sellCount: summary.sellCount,
              brokers: { buy: summary.buy, sell: summary.sell } as object,
              matrix: m
                ? { topBuyer: m, topSeller: matrix?.topSeller ?? null, session: matrix?.session ?? '' }
                : ({ session: matrix?.session ?? '' } as object),
            },
            update: {
              accdist: summary.accdist,
              avgAmount: summary.levels.avg?.amount,
              avgPct: summary.levels.avg?.pct,
              top1Amount: summary.levels.top1?.amount,
              top3Amount: summary.levels.top3?.amount,
              top5Amount: summary.levels.top5?.amount,
              top10Amount: summary.levels.top10?.amount,
              buyCount: summary.buyCount,
              sellCount: summary.sellCount,
              brokers: { buy: summary.buy, sell: summary.sell } as object,
              matrix: m
                ? { topBuyer: m, topSeller: matrix?.topSeller ?? null, session: matrix?.session ?? '' }
                : ({ session: matrix?.session ?? '' } as object),
            },
          })
          bandarCount++
        } catch {
          // Per-symbol misses normal (illiquid codes, session gaps)
        }
        await sleep(DELAY_MS)
      }
    }

    let guruTotal = 0
    if (runAll || onlyGuru) {
      const templates = tplArg ? tplArg.split(',').map(Number).filter(Number.isFinite) : DEFAULT_TEMPLATES
      for (const templateId of templates) {
        try {
          const run = await fetchGuruRun(templateId)
          await prisma.idxStockbitGuru.upsert({
            where: { templateId_snapshotDate: { templateId, snapshotDate } },
            create: {
              templateId,
              templateName: run.name,
              snapshotDate,
              matches: run.matches as object,
            },
            update: { templateName: run.name, matches: run.matches as object },
          })
          guruTotal += run.matches.length
        } catch {
          // preset removed upstream — skip
        }
        await sleep(DELAY_MS)
      }
    }

    let analystCount = 0
    if (runAll || onlyAnalyst) {
      for (const code of codes) {
        try {
          const a = await fetchAnalyst(code)
          if (!a || a.total === 0) continue
          await prisma.idxStockbitAnalyst.upsert({
            where: { code_snapshotDate: { code, snapshotDate } },
            create: {
              code,
              snapshotDate,
              recommendation: a.recommendation,
              buy: a.buy,
              sell: a.sell,
              hold: a.hold,
              total: a.total,
              target: a.target,
              low: a.low,
              high: a.high,
              updatedAt: a.updatedAt,
            },
            update: {
              recommendation: a.recommendation,
              buy: a.buy,
              sell: a.sell,
              hold: a.hold,
              total: a.total,
              target: a.target,
              low: a.low,
              high: a.high,
              updatedAt: a.updatedAt,
            },
          })
          analystCount++
        } catch {
          // no coverage for this code
        }
        await sleep(DELAY_MS)
      }
    }

    // Stream sample (proves feed shape; not persisted — hourly lane later).
    try {
      const s = await fetchStreamPosts('BBRI', 3)
      console.log(`[idx-stockbit] stream sample BBRI: ${s.posts.length} posts, cursor=${s.cursor ? 'yes' : 'no'}`)
    } catch {
      console.log('[idx-stockbit] stream sample skipped (feed unavailable)')
    }

    console.log(
      `[idx-stockbit] bandar ${bandarCount} rows · guru ${guruTotal} matches · analyst ${analystCount} rows · snapshotDate ${snapshotDate}`,
    )
  } catch (err) {
    console.error('[idx-stockbit] harvest failed:', err instanceof Error ? err.message : err)
    await notifyAlert('IDX Stockbit harvest failed', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
