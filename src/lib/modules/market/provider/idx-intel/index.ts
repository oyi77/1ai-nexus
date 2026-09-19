// ─────────────────────────────────────────────────────────────
// IDX Intel Report — one fused verdict per stock for the dashboard.
// Fuses 6 sources: foreign streak + bandar accdist + guru screens +
// analyst consensus + alpha score + screener fundamentals.
// Sellable surface: GET /api/v1/saham/intel?symbol=XXX (per-stock)
//                   GET /api/v1/saham/intel?top=20 (ranked universe)
// SERVER-ONLY. Zero upstream calls (all Prisma).
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'
import { getForeignStreaks } from '@/lib/modules/market/provider/idx-bandarmology'

const CACHE_TTL = 10 * 60_000

export interface IntelReport {
  code: string
  name: string
  price: number
  changePct: number
  verdict: 'STRONG BUY' | 'BUY' | 'WATCH' | 'AVOID' | 'SELL'
  score: number
  reasons: Array<{ text: string; weight: number }>
  foreign: { streakDays: number; dir: string | null }
  bandar: { accdist: string; top1Amount: number | null }
  guru: string[]
  analyst: { rec: string; target: number | null; upsidePct: number | null } | null
  fundamentals: { per: number | null; pbv: number | null; roe: number | null }
}

export async function getIntelReport(code: string): Promise<IntelReport | null> {
  const sym = code.trim().toUpperCase().replace(/\.JK$/, '')
  const { data } = await getCached(`idx-intel:${sym}`, CACHE_TTL, async () => {
    const [session, screener, bandar, guruRows, analystRow, streaks] = await Promise.all([
      prisma.idxSahamSession.findFirst({ where: { code: sym }, orderBy: { tradeDate: 'desc' } }),
      prisma.idxScreenerSnapshot.findFirst({ where: { code: sym }, orderBy: { snapshotDate: 'desc' } }),
      prisma.idxBandarSnapshot.findFirst({ where: { code: sym }, orderBy: { tradeDate: 'desc' } }),
      prisma.idxStockbitGuru.findMany({ orderBy: { snapshotDate: 'desc' }, take: 8 }),
      prisma.idxStockbitAnalyst.findFirst({ where: { code: sym }, orderBy: { snapshotDate: 'desc' } }),
      getForeignStreaks(3, 2000).catch(() => ({ accumulation: [], distribution: [] }) as { accumulation: Array<{ code: string; days: number }>; distribution: Array<{ code: string; days: number }> }),
    ])
    if (!session) return { report: null }

    const acc = streaks.accumulation.find((s) => s.code === sym)
    const dist = streaks.distribution.find((s) => s.code === sym)
    const streakDays = acc?.days ?? dist?.days ?? 0
    const streakDir = acc ? 'accumulation' : dist ? 'distribution' : null

    const guruHits = guruRows
      .filter((g) => JSON.stringify(g.matches).includes(`"${sym}"`))
      .map((g) => g.templateName)

    const upsidePct =
      analystRow?.target && session.close > 0
        ? ((analystRow.target - session.close) / session.close) * 100
        : null

    // Weighted verdict: foreign streak + bandar + analyst + momentum
    let score = 50
    const reasons: Array<{ text: string; weight: number }> = []
    if (streakDir === 'accumulation') {
      score += Math.min(streakDays * 2, 20)
      reasons.push({ text: `Foreign accumulation ${streakDays}d`, weight: 0.3 })
    } else if (streakDir === 'distribution') {
      score -= Math.min(streakDays * 2, 20)
      reasons.push({ text: `Foreign distribution ${streakDays}d`, weight: 0.3 })
    }
    if (bandar && /acc/i.test(bandar.accdist)) {
      score += 15
      reasons.push({ text: `Bandar ${bandar.accdist}`, weight: 0.25 })
    } else if (bandar && /dist/i.test(bandar.accdist)) {
      score -= 10
      reasons.push({ text: `Bandar ${bandar.accdist}`, weight: 0.2 })
    }
    if (guruHits.length > 0) {
      score += Math.min(guruHits.length * 3, 12)
      reasons.push({ text: `Guru screens: ${guruHits.slice(0, 2).join(', ')}`, weight: 0.15 })
    }
    if (analystRow) {
      if (/buy/i.test(analystRow.recommendation)) {
        score += 8
        reasons.push({ text: `Analyst ${analystRow.recommendation} target ${analystRow.target}`, weight: 0.15 })
      } else if (/sell/i.test(analystRow.recommendation)) {
        score -= 8
        reasons.push({ text: `Analyst ${analystRow.recommendation}`, weight: 0.15 })
      }
    }
    score = Math.max(0, Math.min(100, Math.round(score)))
    const verdict =
      score >= 70 ? 'STRONG BUY' : score >= 60 ? 'BUY' : score >= 45 ? 'WATCH' : score >= 35 ? 'AVOID' : 'SELL'

    const report: IntelReport = {
      code: sym,
      name: session.name,
      price: session.close,
      changePct: session.prev > 0 ? ((session.close - session.prev) / session.prev) * 100 : 0,
      verdict,
      score,
      reasons,
      foreign: { streakDays, dir: streakDir },
      bandar: { accdist: bandar?.accdist ?? 'unknown', top1Amount: bandar?.top1Amount ?? null },
      guru: guruHits,
      analyst: analystRow
        ? { rec: analystRow.recommendation, target: analystRow.target, upsidePct }
        : null,
      fundamentals: { per: screener?.per ?? null, pbv: screener?.pbv ?? null, roe: screener?.roe ?? null },
    }
    return { report }
  })
  return data.report
}

export async function getTopIntel(limit = 20): Promise<IntelReport[]> {
  const streaks = await getForeignStreaks(3, 2000).catch(() => ({ accumulation: [], distribution: [] }) as { accumulation: Array<{ code: string; days: number }>; distribution: Array<{ code: string; days: number }> })
  const codes = [...streaks.accumulation.slice(0, limit * 2).map((s) => s.code)]
  const out: IntelReport[] = []
  for (const c of codes.slice(0, limit * 2)) {
    const r = await getIntelReport(c)
    if (r) out.push(r)
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
