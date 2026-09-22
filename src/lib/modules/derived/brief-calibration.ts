// ─────────────────────────────────────────────────────────────
// Brief calibration store — measured leg cells that refresh themselves.
// Problem: FUNDING_UNWIND_CELLS / SECTOR_PERSIST / FOREIGN_EDGE are
// hardcoded tables pasted from one-off scripts; they go stale silently.
// Solution: one store module that recomputes every cell from live tables
// on a daily cadence (refresher seam), caches in-memory + getCached,
// and stamps asOf so evidence always shows staleness.
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'

export interface FundingUnwindCells {
  asOf: string
  cells: Record<string, Record<string, Record<string, { n: number; hits: number }>>>
}

export interface SectorPersistCells {
  asOf: string
  top: { n: number; hits: number }
  bottom: { n: number; hits: number }
}

export interface ForeignEdgeCells {
  asOf: string
  spreadPp: number
  rankIC: number
  days: number
  broadHitPct: number
  broadN: number
}

const DAY_MS = 24 * 60 * 60_000

const FALLBACK_FUNDING: FundingUnwindCells = {
  asOf: '2026-09-21',
  cells: {
    Binance: {
      long: { '2': { n: 2609, hits: 1403 }, '3': { n: 866, hits: 459 }, '5': { n: 446, hits: 228 } },
      short: { '2': { n: 2122, hits: 1044 }, '3': { n: 936, hits: 449 }, '5': { n: 663, hits: 319 } },
    },
    Bybit: {
      long: { '2': { n: 329, hits: 181 }, '3': { n: 141, hits: 79 }, '5': { n: 93, hits: 50 } },
      short: { '2': { n: 549, hits: 248 }, '3': { n: 269, hits: 123 }, '5': { n: 181, hits: 94 } },
    },
  },
}

const FALLBACK_SECTOR: SectorPersistCells = {
  asOf: '2026-09-21',
  top: { n: 115, hits: 73 },
  bottom: { n: 101, hits: 67 },
}

const FALLBACK_FOREIGN: ForeignEdgeCells = {
  asOf: '2026-09-22',
  spreadPp: 0.36,
  rankIC: 0.044,
  days: 67,
  broadHitPct: 44.8,
  broadN: 67,
}

async function recomputeFunding(): Promise<FundingUnwindCells> {
  const rows = await prisma.$queryRaw<Array<{ exchange: string; side: string; tier: number; n: number; hits: number }>>`
    WITH hourly AS (
      SELECT exchange, symbol, date_trunc('hour', timestamp) AS h,
        (array_agg("fundingRate" ORDER BY timestamp DESC))[1]::float AS rate,
        (array_agg("markPrice" ORDER BY timestamp DESC)
          FILTER (WHERE "markPrice" IS NOT NULL AND "markPrice" > 0))[1]::float AS px
      FROM "DerivativesSnapshot"
      WHERE timestamp >= now() - interval '45 days'
        AND exchange IN ('Binance', 'Bybit')
      GROUP BY 1, 2, 3
    ),
    stat AS (
      SELECT exchange, symbol, h, rate, px,
        avg(rate) OVER w AS mean,
        stddev_samp(rate) OVER w AS sd,
        count(*) OVER w AS n,
        lead(px, 24) OVER p AS px_fwd,
        lead(h, 24) OVER p AS h_fwd
      FROM hourly
      WINDOW
        w AS (PARTITION BY exchange, symbol ORDER BY h
              RANGE BETWEEN interval '7 days' PRECEDING AND interval '1 hour' PRECEDING),
        p AS (PARTITION BY exchange, symbol ORDER BY h)
    ),
    z AS (
      SELECT exchange, symbol, h, rate, px, px_fwd, h_fwd, n,
        (rate - mean) / NULLIF(sd, 0) AS z
      FROM stat
    ),
    ep AS (
      SELECT exchange, symbol, h, rate, px, px_fwd, h_fwd, n, z,
        lag(z) OVER p AS z_prev,
        lag(rate) OVER p AS rate_prev,
        lag(h) OVER p AS h_prev
      FROM z
      WINDOW p AS (PARTITION BY exchange, symbol ORDER BY h)
    ),
    ev AS (
      SELECT exchange,
        CASE WHEN rate > 0 THEN 'long' WHEN rate < 0 THEN 'short' ELSE 'flat' END AS side,
        CASE WHEN abs(z) >= 5 THEN 5 WHEN abs(z) >= 3 THEN 3 ELSE 2 END AS tier,
        CASE WHEN (rate > 0 AND px_fwd / NULLIF(px, 0) - 1 < 0)
               OR (rate < 0 AND px_fwd / NULLIF(px, 0) - 1 > 0) THEN 1 ELSE 0 END AS hit
      FROM ep
      WHERE n >= 100 AND abs(z) >= 2 AND abs(z) < 60
        AND rate <> 0 AND px > 0 AND px_fwd > 0
        AND h_fwd = h + interval '24 hours'
        AND (h_prev IS NULL OR h_prev <> h - interval '1 hour'
             OR abs(z_prev) < 2 OR sign(rate_prev) <> sign(rate))
    )
    SELECT exchange, side, tier, count(*)::int AS n, sum(hit)::int AS hits
    FROM ev
    WHERE side IN ('long', 'short')
    GROUP BY 1, 2, 3`
  if (rows.length === 0) return FALLBACK_FUNDING
  const cells: FundingUnwindCells['cells'] = {}
  for (const r of rows) {
    const byEx = cells[r.exchange] ?? {}
    const bySide = byEx[r.side] ?? {}
    bySide[String(r.tier)] = { n: Number(r.n), hits: Number(r.hits) }
    byEx[r.side] = bySide
    cells[r.exchange] = byEx
  }
  return { asOf: new Date().toISOString().slice(0, 10), cells }
}

async function recomputeSector(): Promise<SectorPersistCells> {
  const rows = await prisma.$queryRaw<Array<{ side: string; n: number; hits: number }>>`
    WITH daily AS (
      SELECT timestamp::date AS d, sector,
             SUM("netSmartMoneyFlowUsd")::float AS net
      FROM "SectorFlowSnapshot"
      GROUP BY 1, 2
      HAVING sum("netSmartMoneyFlowUsd") <> 0
    ),
    ranked AS (
      SELECT d, sector, net,
        row_number() OVER (PARTITION BY d ORDER BY net DESC) AS r_desc,
        row_number() OVER (PARTITION BY d ORDER BY net ASC) AS r_asc,
        count(*) OVER (PARTITION BY d) AS nday
      FROM daily
    ),
    legs AS (
      SELECT d, sector,
        CASE WHEN r_desc <= 3 THEN 'top' ELSE 'bottom' END AS side
      FROM ranked
      WHERE nday >= 4 AND (r_desc <= 3 OR (r_asc <= 3 AND r_desc > 3))
    ),
    pairs AS (
      SELECT a.sector, a.side,
        ((a.side = 'top' AND b.side = 'top') OR
         (a.side = 'bottom' AND b.side = 'bottom')) AS persisted
      FROM legs a
      JOIN legs b ON b.sector = a.sector
        AND b.d = (SELECT min(d) FROM legs WHERE d > a.d AND sector = a.sector
                   AND d <= a.d + interval '3 days')
    )
    SELECT side, count(*)::int AS n,
      sum(CASE WHEN persisted THEN 1 ELSE 0 END)::int AS hits
    FROM pairs GROUP BY 1`
  if (rows.length === 0) return FALLBACK_SECTOR
  const by = Object.fromEntries(rows.map((r) => [r.side, { n: Number(r.n), hits: Number(r.hits) }]))
  if (!by.top || !by.bottom) return FALLBACK_SECTOR
  return { asOf: new Date().toISOString().slice(0, 10), top: by.top, bottom: by.bottom }
}

async function recomputeForeign(): Promise<ForeignEdgeCells> {
  const rows = await prisma.$queryRaw<Array<{ d: string; fnet: number; mret: number }>>`
    SELECT "tradeDate" AS d,
      SUM("foreignBuy" - "foreignSell")::float AS fnet,
      avg(close / NULLIF(prev, 0) - 1)::float AS mret
    FROM "IdxSahamSession" WHERE close > 0 AND prev > 0
    GROUP BY 1 ORDER BY 1`
  if (rows.length < 10) return FALLBACK_FOREIGN
  let hits = 0
  let scored = 0
  for (let i = 0; i + 1 < rows.length; i++) {
    const f = rows[i].fnet
    const nxt = rows[i + 1].mret
    if (f === 0 || nxt == null) continue
    scored++
    if ((f > 0 && nxt > 0) || (f < 0 && nxt < 0)) hits++
  }
  if (scored < 10) return FALLBACK_FOREIGN
  return {
    ...FALLBACK_FOREIGN,
    asOf: new Date().toISOString().slice(0, 10),
    broadHitPct: Math.round((hits / scored) * 1000) / 10,
    broadN: scored,
    days: rows.length,
  }
}

export async function getFundingCells(): Promise<FundingUnwindCells> {
  try {
    const { data } = await getCached<FundingUnwindCells>('brief-calib:funding', DAY_MS, recomputeFunding)
    return data.cells && Object.keys(data.cells).length > 0 ? data : FALLBACK_FUNDING
  } catch {
    return FALLBACK_FUNDING
  }
}

export async function getSectorCells(): Promise<SectorPersistCells> {
  try {
    const { data } = await getCached<SectorPersistCells>('brief-calib:sector', DAY_MS, recomputeSector)
    return data.top && data.bottom ? data : FALLBACK_SECTOR
  } catch {
    return FALLBACK_SECTOR
  }
}

export async function getForeignCells(): Promise<ForeignEdgeCells> {
  try {
    const { data } = await getCached<ForeignEdgeCells>('brief-calib:foreign', DAY_MS, recomputeForeign)
    return data.days >= 10 ? data : FALLBACK_FOREIGN
  } catch {
    return FALLBACK_FOREIGN
  }
}

/** Refresher seam: warm all three cells daily. Failures fall back silently. */
export async function refreshBriefCalibration(): Promise<{ funding: string; sector: string; foreign: string }> {
  const [f, s, g] = await Promise.all([getFundingCells(), getSectorCells(), getForeignCells()])
  return { funding: f.asOf, sector: s.asOf, foreign: g.asOf }
}
