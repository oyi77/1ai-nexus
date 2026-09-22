// ─────────────────────────────────────────────────────────────
// Conviction Producer — the single computation behind
// GET /api/v1/conviction (poll) AND /api/v1/conviction/stream (SSE).
// One source of truth: both surfaces always agree.
// ─────────────────────────────────────────────────────────────

import { getForeignLeaders } from '@/lib/modules/market/provider/idx-bandarmology'
import { getScreenerSnapshot, type ScreenerRow } from '@/lib/modules/market/provider/idx-screener'
import { fetchAlphaSignals, type AlphaSignal } from '@/lib/modules/derived/alpha-feed'
import { fetchOHLCV } from '@/lib/modules/market'
import { computeAlpha } from '@/lib/conviction/alpha-engine'
import { prisma } from '@/lib/db'
import {
  buildCryptoItem,
  buildResult,
  emptyResult,
  fundingToSignal,
  scoreCrypto,
  scoreIdxRow,
  scoreTechnical,
  smartMoneyToSignal,
  whaleToSignal,
  actionFor,
  directionFor,
} from '@/lib/conviction/engine'
import type { ConvictionItem } from '@/lib/conviction/engine'
import { recordConvictionSignal, evaluateTrackRecord } from '@/lib/conviction/track-record'

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'

/** Generic internal fetch that unwraps the { data } envelope; null on any failure. */
async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: T }
    return json.data ?? null
  } catch {
    return null
  }
}

/** Binance 24h ticker for arbitrary USDT pairs — one request, graceful on failure. */
async function fetchBinancePrices(symbols: string[]): Promise<Record<string, { price: number; changePct: number }>> {
  const out: Record<string, { price: number; changePct: number }> = {}
  if (symbols.length === 0) return out
  try {
    const qs = encodeURIComponent(JSON.stringify(symbols))
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${qs}`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) {
      const rows = (await res.json()) as Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>
      for (const r of rows) {
        out[r.symbol] = {
          price: Number(r.lastPrice) || 0,
          changePct: Number(r.priceChangePercent) || 0,
        }
      }
    }
  } catch {
    // Binance down — items report price 0 / changePct 0
  }
  return out
}

/** Aggregate-asset symbols that are not tradable single tokens. */
const CRYPTO_ALLOWLIST = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'LINK',
  'DOT', 'MATIC', 'ARB', 'OP', 'LTC', 'UNI', 'ATOM', 'NEAR', 'APT',
  'SUI', 'SEI', 'INJ', 'TIA', 'PEPE', 'WIF', 'BONK', 'SHIB', 'FLOKI', 'ENA',
])

export type ConvictionResult = ReturnType<typeof buildResult>

/** IDX BUY floor: measured edge lives at alphaScore>=68 only
 * (Sept OOS hit 38.3% avg +0.64 vs <68 33.1% / +0.13;
 * resolved-history P10 64% n=112). Single source — every IDX BUY
 * decision (screener path, bandar merge, bandar insert) must use it. */
export const IDX_BUY_FLOOR = 68

/** Compute the full conviction result (IDX + CRYPTO) and persist BUY/SELL emissions. */
export async function buildConvictionResult(): Promise<ConvictionResult> {
  const [leaders, signals, screenerSnap] = await Promise.all([
    getForeignLeaders(10).catch(() => null),
    fetchAlphaSignals(300),
    getScreenerSnapshot().catch(() => null),
  ])

  // ── IDX (deep: 25-field screener + bandarmology + 6-signal alpha) ──
  const idxItems: ConvictionItem[] = []
  if (screenerSnap?.data) {
    const rows = Object.values(screenerSnap.data)
    const clean = rows.filter((r) => r.roe != null && r.per != null && r.change1d != null)
    const mean = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0)
    const std = (vals: number[]) => {
      if (!vals.length) return 0
      const m = mean(vals)
      return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length)
    }
    const roes = clean.map((r) => r.roe!)
    const pers = clean.map((r) => r.per!)
    const mons = clean.map((r) => r.change1d!)
    // PBV stats added for the alpha engine (legacy stats had no pbv).
    const pbvs = clean.filter((r) => r.pbv != null && r.pbv > 0 && r.pbv <= 20).map((r) => r.pbv!)
    const stats = {
      roeMean: mean(roes), roeStd: std(roes) || 1,
      perMean: mean(pers), perStd: std(pers) || 1,
      momMean: mean(mons), momStd: std(mons),
      pbvMean: mean(pbvs), pbvStd: std(pbvs) || 1,
    }
    // Bulk session data (last 30 dates) + broker board for the alpha engine.
    // Best-effort: on any failure, fall back to legacy scoreIdxRow.
    let sessionsByCode = new Map<string, Array<{
      date: string; close: number; volume: number; value: number
      foreignBuy: number; foreignSell: number; high: number; low: number; open: number
    }>>()
    let brokersForAlpha: Array<{ firm: string; value: number; volume: number }> = []
    try {
      const distinctDates = await prisma.idxSahamSession.findMany({
        distinct: ["tradeDate"], orderBy: { tradeDate: "desc" }, select: { tradeDate: true }, take: 30,
      })
      const dates = distinctDates.map((d) => d.tradeDate).sort()
      if (dates.length > 0) {
        const sessionRows = await prisma.idxSahamSession.findMany({
          where: { tradeDate: { in: dates } },
          select: { code: true, tradeDate: true, foreignBuy: true, foreignSell: true, close: true, volume: true, value: true, high: true, low: true, open: true },
        })
        for (const r of sessionRows) {
          const arr = sessionsByCode.get(r.code) ?? []
          arr.push({ date: r.tradeDate, close: r.close, volume: r.volume, value: r.value, foreignBuy: r.foreignBuy, foreignSell: r.foreignSell, high: r.high, low: r.low, open: r.open })
          sessionsByCode.set(r.code, arr)
        }
        const latestSessionDate = dates[dates.length - 1]
        brokersForAlpha = await prisma.idxBrokerBoard.findMany({
          where: { tradeDate: latestSessionDate }, select: { firm: true, value: true, volume: true },
        })
      }
    } catch {
      sessionsByCode = new Map()
      brokersForAlpha = []
    }
    const scored = rows.map((r: ScreenerRow) => {
      const sess = sessionsByCode.get(r.symbol)
      // Alpha path: rich 6-signal engine when session data exists.
      if (sess && sess.length > 0) {
        try {
          const result = computeAlpha({
            sessions: sess,
            brokers: brokersForAlpha,
            screener: {
              per: r.per, pbv: r.pbv, roe: r.roe, der: r.der,
              change1d: r.change1d, change4w: r.change4w, change13w: r.change13w,
              change26w: r.change26w, change52w: r.change52w, marketCap: r.marketCap,
              price: r.price, high52w: r.high52w, low52w: r.low52w,
            },
            universeStats: {
              perMean: stats.perMean, perStd: stats.perStd,
              roeMean: stats.roeMean, roeStd: stats.roeStd,
              pbvMean: stats.pbvMean, pbvStd: stats.pbvStd,
            },
          })
          const alphaReasons = result.topReasons.map((t) => ({ text: t, weight: 0.3 }))
          const base = scoreIdxRow(r, { roeMean: stats.roeMean, roeStd: stats.roeStd, perMean: stats.perMean, perStd: stats.perStd, momMean: stats.momMean, momStd: stats.momStd })
          // Blend: alpha dominates (70%), legacy fundamentals anchor (30%).
          const score = Math.round(result.totalScore * 0.7 + base.score * 0.3)
          const reasons = [...alphaReasons, ...base.reasons].slice(0, 6)
          return { r, score: Math.max(0, Math.min(100, score)), reasons, viaAlpha: true }
        } catch {
          // Alpha threw (bad row shape) — fall through to legacy.
        }
      }
      // Legacy path: simple z-score fundamentals.
      return { r, ...scoreIdxRow(r, { roeMean: stats.roeMean, roeStd: stats.roeStd, perMean: stats.perMean, perStd: stats.perStd, momMean: stats.momMean, momStd: stats.momStd }), viaAlpha: false }
    })
    const byScore = [...scored].sort((a, b) => b.score - a.score)
    const topBuy = byScore.slice(0, 15)
    const bottomSell = byScore.slice(-8)
    const seen = new Set(topBuy.map((s) => s.r.symbol))
    const sel = topBuy.concat(bottomSell.filter((s) => !seen.has(s.r.symbol)))
      .sort((a, b) => b.score - a.score)
    for (const { r, score, reasons, viaAlpha } of sel) {
      // BUY floor 68: below-68 IDX longs show no edge (Sept OOS 33.1% /
      // +0.13 vs 68+ 38.3% / +0.64). Emitting them burns the win rate
      // toward 1.8% population. WAIT instead — never score noise.
      const action = score >= IDX_BUY_FLOOR ? 'BUY' : score < 35 ? 'SELL' : 'WAIT'
      idxItems.push({
        symbol: r.symbol,
        name: r.name,
        price: r.price ?? 0,
        changePct: r.change1d ?? 0,
        conviction: score,
        action,
        direction: score >= IDX_BUY_FLOOR ? 'bull' : score < 35 ? 'bear' : 'neutral',
        reasons,
        sources: viaAlpha ? ['screener', 'alpha-engine'] : ['screener'],
      })
    }
    if (leaders) {
      for (const l of leaders.topBuy.slice(0, 5)) {
      const existing = idxItems.find((i) => i.symbol === l.code)
      if (existing) {
        existing.reasons.push({ text: `Foreign net buy leader`, weight: 0.35 })
        existing.sources.push('bandarmology')
        existing.conviction = Math.min(100, existing.conviction + 10)
        existing.action = existing.conviction >= IDX_BUY_FLOOR ? 'BUY' : existing.conviction < 35 ? 'SELL' : 'WAIT'
        existing.direction = existing.conviction >= IDX_BUY_FLOOR ? 'bull' : existing.conviction <= 35 ? 'bear' : 'neutral'
      } else {
        idxItems.push({
          symbol: l.code,
          name: l.name,
          price: l.close,
          changePct: l.changePct,
          conviction: Math.max(70, IDX_BUY_FLOOR),
          action: 'BUY',
          direction: 'bull',
          reasons: [{ text: `Foreign net buy leader (top daily)`, weight: 0.4 }],
          sources: ['bandarmology'],
        })
      }
    }
  }
  }

  // ── CRYPTO ──
  const [fundingData, whaleData, smartMoneyData] = await Promise.all([
    api<{ topPairs?: Array<Record<string, unknown>> }>('/api/v1/derivatives?limit=50'),
    api<{ items?: Array<Record<string, unknown>> }>('/api/v1/whale-alert'),
    api<Array<Record<string, unknown>>>('/api/v1/smart-money?pageSize=20'),
  ])

  const extraSignals: AlphaSignal[] = []
  const fundingPairs = fundingData?.topPairs ?? []
  for (const p of fundingPairs) {
    const s = fundingToSignal({
      symbol: String(p.symbol ?? ''),
      fundingRate: Number(p.fundingRate ?? 0),
      exchange: String(p.exchange ?? 'binance'),
    })
    if (s) extraSignals.push(s as AlphaSignal)
  }
  const whaleAlerts = whaleData?.items ?? []
  for (const w of whaleAlerts) {
    const s = whaleToSignal({
      amount: Number(w.amount ?? 0),
      symbol: String(w.symbol ?? ''),
      usd: Number(w.usd ?? 0),
      from: String(w.from ?? ''),
      to: String(w.to ?? ''),
    })
    if (s) extraSignals.push(s as AlphaSignal)
  }
  const smartWallets = smartMoneyData ?? []
  for (const sm of smartWallets) {
    const s = smartMoneyToSignal(sm as Record<string, unknown>)
    if (s) extraSignals.push(s as AlphaSignal)
  }

  const allSignals = [...(signals ?? []), ...extraSignals]

  const cryptoItems: ConvictionItem[] = []
  if (allSignals.length > 0) {
    const byAsset = new Map<string, AlphaSignal[]>()
    for (const s of allSignals) {
      const asset = s.asset.toUpperCase().replace(/USDT|USDC|BUSD|FDUSD$/g, '')
      if (!CRYPTO_ALLOWLIST.has(asset)) continue
      if (!byAsset.has(asset)) byAsset.set(asset, [])
      byAsset.get(asset)!.push(s)
    }
    const ranked = [...byAsset.entries()]
      .map(([asset, sigs]) => ({ asset, sigs, conviction: scoreCrypto(sigs) }))
      .sort((a, b) => b.sigs.length - a.sigs.length)
      .slice(0, 15)

    const [thesisResults, priceMap, ohlcvResults] = await Promise.all([
      Promise.allSettled(ranked.map((r) => api<{ thesis: string }>(`/api/v1/token/thesis?symbol=${r.asset}`))),
      fetchBinancePrices(ranked.map((r) => `${r.asset}USDT`)),
      Promise.allSettled(ranked.map((r) => fetchOHLCV({ symbol: `${r.asset}USDT`, interval: '1d', limit: 100 }))),
    ])

    ranked.forEach((r, i) => {
      const thesis = thesisResults[i].status === 'fulfilled' ? (thesisResults[i].value?.thesis ?? null) : null
      const item = buildCryptoItem(r.asset, r.sigs, thesis, priceMap[`${r.asset}USDT`])
      const ohlcvRes = ohlcvResults[i]
      const candles = ohlcvRes.status === 'fulfilled' ? (ohlcvRes.value?.candles ?? []) : []
      const tech = scoreTechnical(candles)
      if (tech.scoreDelta !== 0) {
        item.conviction = Math.max(0, Math.min(100, item.conviction + tech.scoreDelta))
        item.action = actionFor(item.conviction)
        item.direction = directionFor(item.conviction)
        item.reasons = [...item.reasons, ...tech.reasons]
        if (!item.sources.includes('technical')) item.sources.push('technical')
      }
      cryptoItems.push(item)
    })
  }

  // ── Track record (PROOF layer) — persist this emission + evaluate matured.
  // Also bridge to backtest engine so conviction signals get full PnL evaluation.
  void (async () => {
    const { storeSignal } = await import('@/lib/modules/derived/backtest-engine')

    for (const item of idxItems) {
      if (item.action === 'WAIT') continue
      await recordConvictionSignal({
        symbol: item.symbol, market: 'IDX', conviction: item.conviction,
        action: item.action, direction: item.direction, price: item.price > 0 ? item.price : undefined,
        reasons: item.reasons,
      })
      // NOTE: no backtest bridge for IDX — BacktestResult evaluates against
      // Binance klines only, so IDX symbols could never resolve (2,069 dead
      // pending rows expired 2026-09-14). IDX proof lives in ConvictionSignal
      // (market=IDX) + AlphaTrackRecord lanes.
    }
    for (const item of cryptoItems) {
      if (item.action === 'WAIT') continue
      await recordConvictionSignal({
        symbol: item.symbol, market: 'CRYPTO', conviction: item.conviction,
        action: item.action, direction: item.direction, price: item.price > 0 ? item.price : undefined,
        reasons: item.reasons,
      })
      if (item.price > 0) {
        const dir = item.action === 'BUY' ? 'bullish' : 'bearish'
        const conv = item.conviction / 100
        await storeSignal({
          id: `conviction-crypto-${item.symbol}-${Date.now()}`,
          symbol: item.symbol,
          direction: dir,
          entry: item.price,
          tp1: item.price * (1 + (item.action === 'BUY' ? conv : -conv) * 0.05),
          tp2: item.price * (1 + (item.action === 'BUY' ? conv : -conv) * 0.10),
          tp3: item.price * (1 + (item.action === 'BUY' ? conv : -conv) * 0.20),
          sl: item.price * (1 - (item.action === 'BUY' ? conv : -conv) * 0.03),
          timestamp: Date.now(),
          source: 'conviction',
        }).catch(() => {})
      }
    }
    await evaluateTrackRecord().catch(() => {})
  })()

  return buildResult(idxItems, cryptoItems)
}

// ─────────────────────────────────────────────────────────────
// Adaptive TTL: conviction compute is heavy (~10s+), but during
// high volatility we want fresher data. TTL scales with VIX:
//   VIX > 30 (crisis) → 15s
//   VIX < 15 (calm)   → 60s
//   else              → 25s
// ─────────────────────────────────────────────────────────────
const BASE_TTL_MS = 25_000
const HIGH_VOL_TTL_MS = 15_000
const LOW_VOL_TTL_MS = 60_000
let cachedResult: ConvictionResult | null = null
let cachedAt = 0
let inflight: Promise<ConvictionResult> | null = null
let currentTtlMs = BASE_TTL_MS

/** Cached result if fresh (< TTL), else null. */
export function peekCachedConviction(): ConvictionResult | null {
  if (cachedResult && Date.now() - cachedAt < currentTtlMs) return cachedResult
  return null
}
async function fetchVixLevel(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key=' +
      (process.env.FRED_API_KEY ?? '') +
      '&file_type=json&sort_order=desc&limit=1'
    )
    const data = await res.json()
    const obs = data?.observations?.[0]
    return obs?.value ? Number(obs.value) : null
  } catch {
    return null
  }
}

/** Update TTL based on VIX. Called before each recompute. */
async function updateAdaptiveTtl(): Promise<void> {
  const vix = await fetchVixLevel()
  if (vix === null) {
    currentTtlMs = BASE_TTL_MS
  } else if (vix > 30) {
    currentTtlMs = HIGH_VOL_TTL_MS
  } else if (vix < 15) {
    currentTtlMs = LOW_VOL_TTL_MS
  } else {
    currentTtlMs = BASE_TTL_MS
  }
}
/**
 * Returns a fresh-enough result WITHOUT recomputing if the cache is hot,
 * or shares the single in-flight recompute if one is already running.
 * Guarantees at most one buildConvictionResult() per TTL window.
 * On compute failure: returns stale cache (with stale:true) if available.
 */
export async function getCachedConvictionResult(): Promise<ConvictionResult> {
  const hot = peekCachedConviction()
  if (hot) return hot
  if (inflight) return inflight

  // Update TTL based on volatility before recomputing
  await updateAdaptiveTtl()

  const running = buildConvictionResult()
  inflight = running
  try {
    const result = await running
    cachedResult = result
    cachedAt = Date.now()
    return result
  } catch {
    // Compute failed — serve stale cache if we have any
    if (cachedResult) {
      return { ...cachedResult, stale: true }
    }
    return emptyResult()
  } finally {
    inflight = null
  }
}

/** Current TTL in ms (for monitoring). */
export function getConvictionTtl(): number {
  return currentTtlMs
}
