// ─────────────────────────────────────────────────────────────
// Insight Brief — cross-domain transmission engine (SERVER-ONLY).
// Reads: DerivativesSnapshot (funding history), IdxSahamSession (foreign
// flow), AlphaTrackRecord (measured P20/P10 per verdict), IdxBandarSnapshot
// (per-stock accumulation), SectorFlowSnapshot, SentimentSnapshot, ETFFlow.
// Emits: ranked narratives, each with a measured confidence (P10/P20 from
// the calibration tables) or an explicit `unproven: true` label.
// Zero upstream calls. All reads Prisma.
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'
import { getFundingCells, getSectorCells, getForeignCells } from '@/lib/modules/derived/brief-calibration'
import type { FundingUnwindCells, SectorPersistCells } from '@/lib/modules/derived/brief-calibration'

const CACHE_TTL = 10 * 60_000

export interface Transmission {
  id: string
  from: string
  to: string[] // affected assets/sectors/legs
  direction: 'bullish' | 'bearish' | 'neutral'
  narrative: string
  evidence: Array<{ metric: string; value: string; source: string }>
  confidence: number // 0-100: measured P10/P20 of the cited verdict, or 50 + flagged
  unproven: boolean
  measured?: { n: number; p20: number; p10: number }
  // measured semantics are per-leg, stated in evidence: IDX legs carry
  // P(MFE>=20%/10%); funding legs carry the 24h unwind hit rate in both.
}

export interface InsightBrief {
  generatedAt: string
  regime: 'risk-on' | 'risk-off' | 'mixed'
  transmissions: Transmission[]
}

/** Adaptive USD flow formatting: M >= $1M, K >= $1K, raw below.
 * The old single-unit M formatter collapsed every real sector flow ($5-12K)
 * into a useless "+$0.00M" wall (proven live 2026-09-21). */
export function formatFlowUsd(n: number): string {
  const a = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${Math.round(a)}`
}

/** Measured IDX tail rates per verdict: P(MFE>=20%/>=10% in 30d). */
async function idxTailRates(): Promise<Record<string, { p20: number; p10: number; n: number }>> {
  const out: Record<string, { p20: number; p10: number; n: number }> = {}
  try {
    const rows = await prisma.alphaTrackRecord.findMany({
      where: { lane: 'moonshot', maxGain30dPct: { not: null } },
      select: { verdict: true, maxGain30dPct: true },
      take: 15000,
    })
    const by: Record<string, number[]> = {}
    for (const r of rows) {
      if (r.maxGain30dPct == null) continue
      const arr = by[r.verdict] ?? []
      arr.push(r.maxGain30dPct)
      by[r.verdict] = arr
    }
    for (const [v, ms] of Object.entries(by)) {
      if (ms.length < 20) continue
      out[v] = {
        p20: (ms.filter((m) => m >= 20).length / ms.length) * 100,
        p10: (ms.filter((m) => m >= 10).length / ms.length) * 100,
        n: ms.length,
      }
    }
  } catch { /* measured lookup unavailable — callers flag unproven */ }
  return out
}

/** Per-symbol funding z-score vs its own 7d history. Positive = crowded longs. */
async function fundingExtremes(limit = 8): Promise<Array<{ symbol: string; exchange: string; rate: number; z: number }>> {
  let rows: Array<{ exchange: string; symbol: string; rate: number; z: number }> = []
  try {
    // Exact per-symbol 7d stats in SQL — a row-capped fetch silently biases
    // both mean and sd toward the newest slice of the window.
    const raw = await prisma.$queryRaw<Array<{ exchange: string; symbol: string; rate: number; mean: number; sd: number }>>`
      SELECT exchange, symbol,
        (array_agg("fundingRate" ORDER BY timestamp DESC))[1]::float AS rate,
        avg("fundingRate")::float AS mean,
        stddev_samp("fundingRate")::float AS sd
      FROM "DerivativesSnapshot"
      WHERE timestamp >= now() - interval '7 days'
      GROUP BY exchange, symbol
      HAVING count(*) >= 50 AND stddev_samp("fundingRate") > 0`
    rows = raw
      .map((r) => ({ exchange: r.exchange, symbol: r.symbol, rate: r.rate, z: (r.rate - r.mean) / r.sd }))
      .filter((r) => Number.isFinite(r.z) && Math.abs(r.z) >= 2)
      .map((r) => ({ ...r, z: Math.round(r.z * 100) / 100 }))
  } catch { return [] }
  return rows.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, limit)
}

/** Measured 24h contrarian-unwind hit rates per exchange+side+tier.
 * Backtest 2026-06-30..2026-09-21 over DerivativesSnapshot hourly bars:
 * event = trailing-7d funding |z|>=tier episode start (side from RATE sign,
 * exactly like fundingExtremes); outcome = 24h forward markPrice move
 * opposing the crowded side. Crowded longs unwind 53-56% (measured);
 * crowded shorts do NOT (47-49%) — the leg reports the rate either way.
 * Refresh via scripts/measure-funding-unwind.py and paste new cells here.
 * measuredAsOf stamps the evidence so readers see staleness. */
/** Pooled unwind hit rate for an exchange+side leg at a given |z|.
 * Exact tier cell when n>=20, else the exchange+side pool, else null. */
function fundingUnwind(cells: FundingUnwindCells['cells'], exchange: string, side: 'long' | 'short', z: number): { n: number; rate: number } | null {
  const bySide = cells[exchange]?.[side]
  if (!bySide) return null
  const az = Math.abs(z)
  let tier = '2'
  if (az >= 5) tier = '5'
  else if (az >= 3) tier = '3'
  const cell = bySide[tier]
  if (cell && cell.n >= 20) return { n: cell.n, rate: Math.round((cell.hits / cell.n) * 1000) / 10 }
  let n = 0
  let hits = 0
  for (const c of Object.values(bySide)) {
    n += c.n
    hits += c.hits
  }
  if (n < 20) return null
  return { n, rate: Math.round((hits / n) * 1000) / 10 }
}

/** Measured foreign-flow edge (backtest 2026-06-15..2026-09-19, 67 days,
 * 64,368 stock-day rows of IdxSahamSession).
 * Cross-sectional: top-decile foreign-net stocks beat bottom-decile by
 * +0.36pp next session (0.36% vs 0.01%), rank IC +0.044 — stock selection
 * edge is real. Broad-market: daily aggregate sign predicts next-day market
 * sign only 30/67 = 44.8% — the directional leg stays basket-gated, never
 * a market call. Refresh via scripts/measure-foreign-edge.py. */

/** IDX foreign flow direction over the latest sessions. */
async function idxForeignFlow(): Promise<{ dir: 'accumulation' | 'distribution' | 'flat'; streak: number; netRp: number } | null> {
  try {
    const dates = await prisma.idxSahamSession.findMany({
      distinct: ['tradeDate'], orderBy: { tradeDate: 'desc' }, select: { tradeDate: true }, take: 10,
    })
    const ds = dates.map((d) => d.tradeDate).sort()
    if (ds.length === 0) return null
    const agg = await prisma.$queryRaw<Array<{ d: string; net: number }>>`
      SELECT "tradeDate" AS d, SUM("foreignBuy" - "foreignSell")::float AS net
      FROM "IdxSahamSession" WHERE "tradeDate" = ANY(${ds}) GROUP BY "tradeDate" ORDER BY "tradeDate" DESC LIMIT 5`
    // Skip zero-net days (weekends/holidays print a 0.0 session row that would
    // otherwise anchor dir='flat' and kill the leg — proven live 2026-09-21).
    const nz = agg.filter((r) => r.net !== 0)
    if (nz.length === 0) return null
    let streak = 0
    const dir0 = nz[0].net > 0 ? 1 : -1
    for (const r of nz) {
      const d = r.net > 0 ? 1 : -1
      if (d === dir0) streak++
      else break
    }
    return {
      dir: dir0 > 0 ? 'accumulation' : 'distribution',
      streak,
      netRp: Math.round(nz[0].net),
    }
  } catch { return null }
}

/** Measured next-day flow persistence per leg side (backtest 2026-06-30..2026-09-21,
 * 81 days of SectorFlowSnapshot: a leg side persists when the same sector
 * reappears in the same directional third the next day with data).
 * Inflow legs persist 63.5% (73/115); outflow legs 66.3% (67/101).
 * Refresh via scripts/measure-sector-persistence.py and paste new cells here. */

function sectorPersistRate(cells: SectorPersistCells, side: 'top' | 'bottom'): { n: number; rate: number } {
  const c = side === 'top' ? cells.top : cells.bottom
  return { n: c.n, rate: Math.round((c.hits / c.n) * 1000) / 10 }
}

function sectorPersistLine(cells: SectorPersistCells): string {
  const top = sectorPersistRate(cells, 'top')
  const bottom = sectorPersistRate(cells, 'bottom')
  return `inflow ${top.rate}% (n=${top.n}), outflow ${bottom.rate}% (n=${bottom.n}), as of ${cells.asOf}`
}

function sectorPersistPooled(cells: SectorPersistCells): { n: number; rate: number } {
  const n = cells.top.n + cells.bottom.n
  const hits = cells.top.hits + cells.bottom.hits
  return { n, rate: Math.round((hits / n) * 1000) / 10 }
}

/** Sector rotation: net smart-money flow per sector over the latest session day. */
async function sectorRotation(): Promise<{ day: string; top: Array<{ sector: string; net: number }>; bottom: Array<{ sector: string; net: number }> } | null> {
  try {
    // Rows are written one-per-sector with a unique timestamp, so "latest row"
    // yields a single sector. Aggregate the newest DAY: that is the real snapshot.
    const agg = await prisma.$queryRaw<Array<{ sector: string; net: number }>>`
      SELECT sector, SUM("netSmartMoneyFlowUsd")::float AS net
      FROM "SectorFlowSnapshot"
      WHERE timestamp::date = (SELECT max(timestamp)::date FROM "SectorFlowSnapshot")
      GROUP BY sector
      HAVING sum("netSmartMoneyFlowUsd") <> 0
      ORDER BY net DESC`
    const dayRow = await prisma.$queryRaw<Array<{ d: Date }>>`
      SELECT max(timestamp)::date AS d FROM "SectorFlowSnapshot"`
    if (agg.length < 4) return null
    const top = agg.slice(0, 3).map((r) => ({ sector: r.sector, net: Math.round(r.net) }))
    const inflow = new Set(top.map((t) => t.sector))
    const bottom = agg
      .slice(-3)
      .reverse()
      .filter((r) => !inflow.has(r.sector))
      .map((r) => ({ sector: r.sector, net: Math.round(r.net) }))
    if (bottom.length === 0) return null
    return { day: dayRow[0]?.d ? new Date(dayRow[0].d).toISOString().slice(0, 10) : '', top, bottom }
  } catch { return null }
}

/** Crypto fear/greed latest composite score. */
async function fearGreed(): Promise<{ score: number; regime: string } | null> {
  try {
    const rows = await prisma.sentimentSnapshot.findMany({
      where: { source: 'fear-greed' },
      orderBy: { timestamp: 'desc' },
      take: 1,
      select: { score: true },
    })
    if (!rows.length) return null
    const s = rows[0].score
    return { score: Math.round(s), regime: s > 60 ? 'greed' : s < 40 ? 'fear' : 'neutral' }
  } catch { return null }
}

export async function buildInsightBrief(): Promise<InsightBrief> {
  const { data } = await getCached<InsightBrief>('insight-brief:v8', CACHE_TTL, async () => {
    const [tails, funding, foreign, sectors, fg, fCells, sCells, gCells] = await Promise.all([
      idxTailRates(),
      fundingExtremes(),
      idxForeignFlow(),
      sectorRotation(),
      fearGreed(),
      getFundingCells(),
      getSectorCells(),
      getForeignCells(),
    ])

    const tx: Transmission[] = []
    const moon = tails['moonshot']

    // 1) Perpetuals crowding → mean-reversion pressure on named symbols.
    for (const f of funding) {
      // Crowding side comes from the RATE SIGN (longs pay shorts when positive);
      // z only measures how unusual that sign is vs the pair's own 7d history.
      const crowdedLong = f.rate > 0
      const uw = fundingUnwind(fCells.cells, f.exchange, crowdedLong ? 'long' : 'short', f.z)
      tx.push({
        id: `funding:${f.exchange}:${f.symbol}`,
        from: `perps funding ${f.rate >= 0 ? '+' : ''}${(f.rate * 100).toFixed(4)}%/interval (${f.z >= 0 ? '+' : ''}${f.z}σ vs its own 7d)`,
        to: [f.symbol],
        direction: crowdedLong ? 'bearish' : 'bullish',
        narrative: crowdedLong
          ? `Crowded longs on ${f.symbol} — funding ${f.z >= 0 ? '+' : ''}${f.z}σ vs its own 7d mean ${f.z < 0 ? '(cooling, but still paid by longs)' : '(rich)'}. Long-unwind risk.`
          : `Crowded shorts on ${f.symbol} — funding ${f.z >= 0 ? '+' : ''}${f.z}σ vs its own 7d mean ${f.z < 0 ? '(deeply negative)' : '(recovering, shorts still pay)'}. Short-squeeze risk.`,
        evidence: [
          { metric: 'funding z-score (7d)', value: String(f.z), source: 'DerivativesSnapshot' },
          ...(uw
            ? [{ metric: 'unwind hit rate (24h)', value: `${uw.rate}% (n=${uw.n}, as of ${fCells.asOf})`, source: 'DerivativesSnapshot backtest' }]
            : []),
        ],
        confidence: uw ? Math.round(uw.rate) : 50,
        unproven: !uw,
        measured: uw ? { n: uw.n, p20: uw.rate, p10: uw.rate } : undefined,
      })
    }

    // 2) IDX foreign flow → broad market direction (measured: alpha strong-buy excess +2.43pp).
    if (foreign && foreign.dir !== 'flat') {
      const conf = moon && moon.n >= 20 ? Math.round(moon.p10) : 50
      tx.push({
        id: 'idx-foreign-flow',
        from: `foreign ${foreign.dir} ${foreign.streak}d streak (Rp ${(foreign.netRp / 1e9).toFixed(1)}B latest)`,
        to: ['IDX broad market', 'alpha strong-buy basket'],
        direction: foreign.dir === 'accumulation' ? 'bullish' : 'bearish',
        narrative: foreign.dir === 'accumulation'
          ? `Foreigners accumulating IDX ${foreign.streak} sessions running — tailwind for the measured strong-buy basket.`
          : `Foreigners distributing IDX ${foreign.streak} sessions running — headwind; strong-buy needs session-level confirmation.`,
        evidence: [
          { metric: 'foreign net streak', value: `${foreign.streak}d ${foreign.dir}`, source: 'IdxSahamSession' },
          { metric: 'foreign cross-sectional edge', value: `top-decile +${gCells.spreadPp}pp vs bottom, IC ${gCells.rankIC} (${gCells.days}d, as of ${gCells.asOf}); broad-sign hit ${gCells.broadHitPct}% — basket-gated`, source: 'IdxSahamSession backtest' },
        ],
        confidence: conf,
        unproven: !(moon && moon.n >= 20),
        measured: moon && moon.n >= 20 ? { n: moon.n, p20: Math.round(moon.p20 * 10) / 10, p10: Math.round(moon.p10 * 10) / 10 } : undefined,
      })
    }

    // 3) Sector rotation → which cross-asset pockets receive flow vs bleed it.
    if (sectors) {
      tx.push({
        id: 'sector-rotation',
        from: `smart-money rotation ${sectors.day}: ${sectors.top.map((t) => t.sector).join(', ')} receiving`,
        to: [...sectors.top.map((t) => t.sector), ...sectors.bottom.map((s) => `${s.sector} (outflow)`)],
        direction: 'bullish',
        narrative: `${sectors.day} net flow in ${sectors.top.map((t) => `${t.sector} ${formatFlowUsd(t.net)}`).join(', ')}; out of ${sectors.bottom.map((t) => `${t.sector} ${formatFlowUsd(t.net)}`).join(', ')}.`,
        evidence: [
          ...sectors.top.map((t) => ({ metric: `inflow · ${t.sector}`, value: formatFlowUsd(t.net), source: 'SectorFlowSnapshot' })),
          ...sectors.bottom.map((t) => ({ metric: `outflow · ${t.sector}`, value: formatFlowUsd(t.net), source: 'SectorFlowSnapshot' })),
          { metric: 'flow persistence (next day)', value: sectorPersistLine(sCells), source: 'SectorFlowSnapshot backtest' },
        ],
        confidence: Math.round(sectorPersistPooled(sCells).rate),
        unproven: false,
        measured: { n: sectorPersistPooled(sCells).n, p20: sectorPersistPooled(sCells).rate, p10: sectorPersistPooled(sCells).rate },
      })
    }

    // 4) Sentiment extreme → contrarian read (display + gate, not a trade).
    if (fg && (fg.score >= 70 || fg.score <= 30)) {
      tx.push({
        id: 'fear-greed-extreme',
        from: `Fear & Greed ${fg.score} (${fg.regime})`,
        to: ['BTC', 'broad crypto'],
        direction: fg.score >= 70 ? 'bearish' : 'bullish',
        narrative: fg.score >= 70
          ? 'Extreme greed — upside chase is statistically the worst entry; wait for funding to cool.'
          : 'Extreme fear — capitulation zone; scale only into measured setups (moonshot P10-gated).',
        evidence: [
          { metric: 'fear-greed score', value: String(fg.score), source: 'SentimentSnapshot' },
          { metric: 'contrarian read (BTC fwd)', value: 'greed>=70 1d +0.39% / 7d -0.88% (n=11); fear<=30 n=0 in 29d overlap — no measured edge, display-only', source: 'MarketSnapshot backtest' },
        ],
        confidence: 50,
        unproven: true,
      })
    }

    const bearish = tx.filter((t) => t.direction === 'bearish').length
    const bullish = tx.filter((t) => t.direction === 'bullish').length
    const regime: InsightBrief['regime'] = bullish > bearish + 1 ? 'risk-on' : bearish > bullish + 1 ? 'risk-off' : 'mixed'

    return { generatedAt: new Date().toISOString(), regime, transmissions: tx }
  })
  return data
}
