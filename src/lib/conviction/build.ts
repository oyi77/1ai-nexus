// ─────────────────────────────────────────────────────────────
// Conviction Producer — the single computation behind
// GET /api/v1/conviction (poll) AND /api/v1/conviction/stream (SSE).
// One source of truth: both surfaces always agree.
// ─────────────────────────────────────────────────────────────

import { getForeignLeaders } from '@/lib/modules/market/provider/idx-bandarmology'
import { getScreenerSnapshot, type ScreenerRow } from '@/lib/modules/market/provider/idx-screener'
import { fetchAlphaSignals, type AlphaSignal } from '@/lib/modules/derived/alpha-feed'
import { fetchOHLCV } from '@/lib/modules/market'
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

/** Compute the full conviction result (IDX + CRYPTO) and persist BUY/SELL emissions. */
export async function buildConvictionResult(): Promise<ConvictionResult> {
  const [leaders, signals, screenerSnap] = await Promise.all([
    getForeignLeaders(10).catch(() => null),
    fetchAlphaSignals(300),
    getScreenerSnapshot().catch(() => null),
  ])

  // ── IDX (deep: 25-field screener + bandarmology) ──
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
    const stats = {
      roeMean: mean(roes), roeStd: std(roes),
      perMean: mean(pers), perStd: std(pers),
      momMean: mean(mons), momStd: std(mons),
    }
    const scored = rows.map((r: ScreenerRow) => ({ r, ...scoreIdxRow(r, stats) }))
    const byScore = [...scored].sort((a, b) => b.score - a.score)
    const topBuy = byScore.slice(0, 15)
    const bottomSell = byScore.slice(-8)
    const seen = new Set(topBuy.map((s) => s.r.symbol))
    const sel = topBuy.concat(bottomSell.filter((s) => !seen.has(s.r.symbol)))
      .sort((a, b) => b.score - a.score)
    for (const { r, score, reasons } of sel) {
      const action = score >= 65 ? 'BUY' : score < 35 ? 'SELL' : 'WAIT'
      idxItems.push({
        symbol: r.symbol,
        name: r.name,
        price: r.price ?? 0,
        changePct: r.change1d ?? 0,
        conviction: score,
        action,
        direction: score >= 65 ? 'bull' : score < 35 ? 'bear' : 'neutral',
        reasons,
        sources: ['screener'],
      })
    }
  }
  if (leaders) {
    for (const l of leaders.topBuy.slice(0, 5)) {
      const existing = idxItems.find((i) => i.symbol === l.code)
      if (existing) {
        existing.reasons.push({ text: `Foreign net buy leader`, weight: 0.35 })
        existing.sources.push('bandarmology')
        existing.conviction = Math.min(100, existing.conviction + 10)
        existing.action = existing.conviction >= 65 ? 'BUY' : existing.conviction < 35 ? 'SELL' : 'WAIT'
        existing.direction = existing.conviction >= 65 ? 'bull' : existing.conviction <= 35 ? 'bear' : 'neutral'
      } else {
        idxItems.push({
          symbol: l.code,
          name: l.name,
          price: l.close,
          changePct: l.changePct,
          conviction: 70,
          action: 'BUY',
          direction: 'bull',
          reasons: [{ text: `Foreign net buy leader (top daily)`, weight: 0.4 }],
          sources: ['bandarmology'],
        })
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
  void (async () => {
    for (const item of idxItems) {
      if (item.action === 'WAIT') continue
      await recordConvictionSignal({
        symbol: item.symbol, market: 'IDX', conviction: item.conviction,
        action: item.action, direction: item.direction, price: item.price > 0 ? item.price : undefined,
        reasons: item.reasons,
      })
    }
    for (const item of cryptoItems) {
      if (item.action === 'WAIT') continue
      await recordConvictionSignal({
        symbol: item.symbol, market: 'CRYPTO', conviction: item.conviction,
        action: item.action, direction: item.direction, price: item.price > 0 ? item.price : undefined,
        reasons: item.reasons,
      })
    }
    await evaluateTrackRecord().catch(() => {})
  })()

  return buildResult(idxItems, cryptoItems)
}

/** Safe wrapper — never throws; returns empty on any unexpected error. */
export async function safeBuildConvictionResult(): Promise<ConvictionResult> {
  try {
    return await buildConvictionResult()
  } catch {
    return emptyResult()
  }
}

// ─────────────────────────────────────────────────────────────
// Shared cache + in-flight dedup.
// Conviction compute is heavy (~10s+). N connected SSE clients or a
// burst of poll hits must NOT trigger N recomputes — they share ONE
// recompute per CACHE_TTL_MS window. Module-level so every route in
// this process reads the same cache.
// ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 25_000
let cachedResult: ConvictionResult | null = null
let cachedAt = 0
let inflight: Promise<ConvictionResult> | null = null

/** Cached result if fresh (< TTL), else null. */
export function peekCachedConviction(): ConvictionResult | null {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) return cachedResult
  return null
}

/**
 * Returns a fresh-enough result WITHOUT recomputing if the cache is hot,
 * or shares the single in-flight recompute if one is already running.
 * Guarantees at most one buildConvictionResult() per TTL window.
 */
export async function getCachedConvictionResult(): Promise<ConvictionResult> {
  const hot = peekCachedConviction()
  if (hot) return hot
  if (inflight) return inflight

  const running = buildConvictionResult()
  inflight = running
  try {
    const result = await running
    cachedResult = result
    cachedAt = Date.now()
    return result
  } catch {
    return emptyResult()
  } finally {
    inflight = null
  }
}
