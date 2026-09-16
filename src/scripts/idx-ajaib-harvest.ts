// ─────────────────────────────────────────────────────────────
// IDX Ajaib Harvester — nightly universe snapshot + analyst
// consensus from keyless Ajaib endpoints (no auth needed).
//
// Universe: 1 call (page_size=900) → ~882 rows.
// Consensus: per-symbol poll (hour-polite: 300ms delay, top-200
// by marketCap first, single batch; full universe on weekends).
// Units contract: price IDR · marketCap IDR · volume SHARES ·
// week/month momentum multiples (price) + pct (%) + priceChange (IDR).
//
// Cron (weekdays 19:05 — after IDX close, after TV harvest):
//   5 19 * * 1-5 cd /home/openclaw/projects/1ai-tracker && npm run harvest:idx-ajaib >> /tmp/idx-ajaib.log 2>&1
// Writes: IdxAjaibUniverse (all), IdxAjaibConsensus (subset).
// FLAGS: --universe-only (skip consensus), --full (consensus for
// all 882), --limit=N (cap consensus symbols).
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { prisma } from '@/lib/db'
import { notifyAlert } from '@/lib/config/alerting'
import { extractUniverseRecords, rscGet } from '@/lib/modules/market/provider/idx-ajaib/universe'
import { parseAnalysisPayload } from '@/lib/modules/market/provider/idx-ajaib/analysis'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANALYSIS_BASE = 'https://external-api.ajaib.co.id/api/v1/public/investment-experience/asset/analysis'
const CONSENSUS_DELAY_MS = 300
const DEFAULT_CONSENSUS_LIMIT = 200

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const args = new Set(process.argv.slice(2))
  const limitArg = process.argv.find(a => a.startsWith('--limit='))?.slice('--limit='.length)
  try {
    const snapshotDate = new Date().toISOString().slice(0, 10)

    // ── 1. Universe (1 call, direct egress via curl child:
    // Cloudflare on ajaib.co.id 403s Node runtimes on TLS
    // fingerprint — rscGet shells curl which passes.)
    const { status, body: raw } = rscGet('https://ajaib.co.id/saham/aset?page=1&page_size=900')
    if (status !== 200) throw new Error(`Ajaib universe HTTP ${status}`)
    const records = extractUniverseRecords(raw)
    const universeRows = records
      .filter(r => typeof r.code === 'string' && typeof r.name === 'string')
      .map(r => ({
        code: r.code as string,
        snapshotDate,
        name: r.name as string,
        price: num(r.price),
        marketCap: num(r.market_cap),
        volume: num(r.volume),
        weekPrice: num((r.price_1_week as Record<string, unknown> | null)?.price),
        weekPct: num((r.price_1_week as Record<string, unknown> | null)?.pct_change),
        weekChg: num((r.price_1_week as Record<string, unknown> | null)?.price_change),
        monthPrice: num((r.price_1_month as Record<string, unknown> | null)?.price),
        monthPct: num((r.price_1_month as Record<string, unknown> | null)?.pct_change),
        monthChg: num((r.price_1_month as Record<string, unknown> | null)?.price_change),
      }))

    await prisma.$transaction(async tx => {
      for (const row of universeRows) {
        await tx.idxAjaibUniverse.upsert({
          where: { code_snapshotDate: { code: row.code, snapshotDate } },
          create: row,
          update: row,
        })
      }
    })

    // ── 2. Consensus (polite per-symbol poll) ──
    let consensusCount = 0
    if (!args.has('--universe-only')) {
      const limit = args.has('--full')
        ? universeRows.length
        : Math.min(limitArg ? Number(limitArg) : DEFAULT_CONSENSUS_LIMIT, universeRows.length)
      const ranked = [...universeRows]
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
        .slice(0, limit)
      for (const { code } of ranked) {
        try {
          const r = await fetch(`${ANALYSIS_BASE}?asset_type=STOCK&code=${code}`, {
            signal: AbortSignal.timeout(20_000),
            headers: { 'User-Agent': IPHONE_UA, Accept: 'application/json' },
          })
          if (!r.ok) continue
          const parsed = parseAnalysisPayload(code, await r.json())
          if (!parsed) continue
          await prisma.idxAjaibConsensus.upsert({
            where: { code_snapshotDate: { code, snapshotDate } },
            create: {
              code,
              snapshotDate,
              recommendation: parsed.analystRating?.recommendation ?? '',
              buy: parsed.analystRating?.buy ?? 0,
              sell: parsed.analystRating?.sell ?? 0,
              hold: parsed.analystRating?.hold ?? 0,
              total: parsed.analystRating?.total ?? 0,
              targetPrice: parsed.priceEstimates?.target,
              currentPrice: parsed.priceEstimates?.current,
              highPrice: parsed.priceEstimates?.high,
              lowPrice: parsed.priceEstimates?.low,
              consensus: parsed.consensus as object,
              technicals: parsed.technicals as object,
              bands: { pbv: parsed.pbvBand, pe: parsed.peBand } as object,
            },
            update: {
              recommendation: parsed.analystRating?.recommendation ?? '',
              buy: parsed.analystRating?.buy ?? 0,
              sell: parsed.analystRating?.sell ?? 0,
              hold: parsed.analystRating?.hold ?? 0,
              total: parsed.analystRating?.total ?? 0,
              targetPrice: parsed.priceEstimates?.target,
              currentPrice: parsed.priceEstimates?.current,
              highPrice: parsed.priceEstimates?.high,
              lowPrice: parsed.priceEstimates?.low,
              consensus: parsed.consensus as object,
              technicals: parsed.technicals as object,
              bands: { pbv: parsed.pbvBand, pe: parsed.peBand } as object,
            },
          })
          consensusCount++
        } catch {
          // Per-symbol misses are normal (illiquid codes have no analysis payload)
        }
        await sleep(CONSENSUS_DELAY_MS)
      }
    }

    console.log(
      `[idx-ajaib] universe ${universeRows.length} rows · consensus ${consensusCount} rows · snapshotDate ${snapshotDate}`,
    )
  } catch (err) {
    console.error('[idx-ajaib] harvest failed:', err instanceof Error ? err.message : err)
    await notifyAlert('IDX Ajaib harvest failed', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
