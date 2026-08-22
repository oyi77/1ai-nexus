// ─────────────────────────────────────────────────────────────
// LRFG Engine — Leverage Reset / Flow Gap detector
// Consumes the DerivativesSnapshot time-series (appended every minute
// by data-refresher via derivatives-intel.persistDerivativesSnapshot)
// to detect leverage-reset events: a sharp open-interest collapse
// while price has not yet repriced — i.e. a liquidation gap that may
// rebound. Persists to LrfgEvent for the ranker (P5) and alerts.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface LrfgEventDTO {
  id: string
  symbol: string
  exchange: string
  type: 'leverage_reset' | 'rebound'
  severity: number
  oiDeltaPct: number
  priceDeltaPct: number
  fundingRate: number
  longShortRatio: number | null
  detectedAt: string
  reboundedAt: string | null
  outcome: string | null
}

const WINDOW = 30 // snapshots inspected (≈30 min at 1m cadence)
const BASELINE = 20 // trailing snapshots for OI mean/σ
const OI_Z_THRESHOLD = -2 // OI z-score at/below this = sharp drop
const PRICE_FLAT = 0.01 // |price move| under 1% ⇒ gap not yet repriced
const DEDUP_MS = 10 * 60_000

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}
function stdDev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0
  const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}
function priceOf(r: { markPrice: number | null; indexPrice: number | null }): number {
  return r.markPrice ?? r.indexPrice ?? 0
}

type Row = {
  id: string
  symbol: string
  exchange: string
  type: string
  severity: number
  oiDeltaPct: number
  priceDeltaPct: number
  fundingRate: number
  longShortRatio: number | null
  detectedAt: Date
  reboundedAt: Date | null
  outcome: string | null
}

function toDTO(r: Row): LrfgEventDTO {
  return {
    id: r.id,
    symbol: r.symbol,
    exchange: r.exchange,
    type: r.type as LrfgEventDTO['type'],
    severity: r.severity,
    oiDeltaPct: r.oiDeltaPct,
    priceDeltaPct: r.priceDeltaPct,
    fundingRate: r.fundingRate,
    longShortRatio: r.longShortRatio,
    detectedAt: r.detectedAt.toISOString(),
    reboundedAt: r.reboundedAt ? r.reboundedAt.toISOString() : null,
    outcome: r.outcome,
  }
}

async function readSeries(symbol: string, exchange: string) {
  return prisma.derivativesSnapshot.findMany({
    where: { symbol, exchange },
    orderBy: { timestamp: 'desc' },
    take: WINDOW,
  })
}

// Detect + persist new leverage-reset events and update open ones.
// Returns the number of rows written/updated.
export async function detectAndStoreLrfg(symbol: string, exchange = 'Binance'): Promise<number> {
  const rows = await readSeries(symbol, exchange)
  if (rows.length < BASELINE + 5) return 0

  const chrono = [...rows].reverse() // oldest → newest
  const baselineOi = chrono.slice(0, BASELINE).map((r) => r.openInterest)
  const mu = mean(baselineOi)
  const sigma = stdDev(baselineOi, mu) || Math.max(mu * 0.01, 1e-9)
  const latest = chrono[chrono.length - 1]
  const z = (latest.openInterest - mu) / sigma

  const basePrice = priceOf(chrono[0])
  const priceNow = priceOf(latest)
  const priceDeltaPct = basePrice ? (priceNow - basePrice) / basePrice : 0
  const oiDeltaPct = mu ? (latest.openInterest - mu) / mu : 0

  let stored = 0

  // 1) New leverage-reset: OI collapsed, price flat ⇒ liquidation gap
  if (z <= OI_Z_THRESHOLD && Math.abs(priceDeltaPct) < PRICE_FLAT) {
    const recent = await prisma.lrfgEvent.findFirst({
      where: { symbol, exchange, type: 'leverage_reset' },
      orderBy: { detectedAt: 'desc' },
    })
    const fresh = !recent || Date.now() - recent.detectedAt.getTime() > DEDUP_MS
    if (fresh) {
      await prisma.lrfgEvent.create({
        data: {
          symbol,
          exchange,
          type: 'leverage_reset',
          severity: clamp01(-z / 3),
          oiDeltaPct,
          priceDeltaPct,
          fundingRate: latest.fundingRate,
          longShortRatio: latest.longShortRatio,
        },
      })
      // Emit a system alert so the alert-engine surfaces the event.
      await prisma.alert.create({
        data: {
          userId: 'system',
          triggerType: 'lrfg_leverage_reset',
          name: `LRFG reset ${symbol}@${exchange}`,
          condition: `OI z=${z.toFixed(2)} priceΔ=${(priceDeltaPct * 100).toFixed(2)}%`,
          conditions: {
            symbol,
            exchange,
            oiZ: z,
            oiDeltaPct,
            priceDeltaPct,
            fundingRate: latest.fundingRate,
          },
        },
      })
      stored++
    }
  }

  // 2) Update open resets: rebound if price reclaimed or OI rebuilt
  const open = await prisma.lrfgEvent.findMany({
    where: { symbol, exchange, type: 'leverage_reset', outcome: null },
    orderBy: { detectedAt: 'desc' },
    take: 5,
  })
  for (const ev of open) {
    const reclaimed = Math.abs(priceDeltaPct) > PRICE_FLAT && priceDeltaPct > 0
    const rebuilt = z > -0.5
    if (reclaimed || rebuilt) {
      await prisma.lrfgEvent.update({
        where: { id: ev.id },
        data: { outcome: reclaimed ? 'success' : 'partial', reboundedAt: new Date() },
      })
      stored++
    }
  }
  return stored
}

export async function fetchLrfgEvents(opts: { symbol?: string; exchange?: string; limit?: number } = {}): Promise<LrfgEventDTO[]> {
  const where = opts.symbol ? { symbol: opts.symbol } : opts.exchange ? { exchange: opts.exchange } : {}
  const rows = await prisma.lrfgEvent.findMany({
    where,
    orderBy: { detectedAt: 'desc' },
    take: opts.limit ?? 50,
  })
  return rows.map((r) => toDTO(r as Row))
}
