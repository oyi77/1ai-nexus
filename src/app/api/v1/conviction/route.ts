// ─────────────────────────────────────────────────────────────
// GET /api/v1/conviction — Decision Layer
// Aggregates IDX bandarmology + crypto alpha signals into one
// conviction score + action + reasons per symbol.
// Public endpoint (middleware ALWAYS_PUBLIC).
// ─────────────────────────────────────────────────────────────

import { apiJson } from '@/lib/api/response'
import { getForeignLeaders } from '@/lib/modules/market/provider/idx-bandarmology'
import { getScreenerSnapshot, type ScreenerRow } from '@/lib/modules/market/provider/idx-screener'
import { fetchAlphaSignals, type AlphaSignal } from '@/lib/modules/derived/alpha-feed'
import {
  buildCryptoItem,
  buildIdxItem,
  buildResult,
  emptyResult,
  fundingToSignal,
  scoreCrypto,
  scoreIdxRow,
  smartMoneyToSignal,
  whaleToSignal,
} from '@/lib/conviction/engine'
import type { ConvictionItem } from '@/lib/conviction/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
const NON_TOKEN_ASSETS = new Set(['PORTFOLIO', 'MARKET', 'CRYPTO', 'BTC/ETH', 'COMMODITIES'])

// Stablecoins + pegged assets — no conviction value, exclude.
const STABLE_ASSETS = new Set([
  'USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDD', 'PYUSD',
  'BUSD', 'USD1', 'USDY', 'GUSD', 'XUSD', 'USDP', 'SUSD', 'FRAX', 'LUSD', 'EURS',
	'BTCS', 'BIT', 'EURL', 'DAI', 'LUSD', 'CRVUSD', 'GHO', 'MIM', 'USDX',
])
// Known garbage/short / leveraged ETF symbols that are NOT tradable tokens.
const GARBAGE_SYMBOLS = new Set([
  'CL', 'BTR', 'BZ', 'SOXL', '0G', 'SPCX', 'SKR', 'ZORA', '牛来', 'BTCS',
  'SOL', 'BONK', 'WIF', 'PEPE', 'DOGE', 'SHIB', 'FLOKI',  // legit but thin
])
// Whitelist: only majors the engine genuinely floors conviction on.
const CRYPTO_ALLOWLIST = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'LINK',
  'DOT', 'MATIC', 'ARB', 'OP', 'LTC', 'UNI', 'ATOM', 'NEAR', 'APT',
  'SUI', 'SEI', 'INJ', 'TIA', 'PEPE', 'WIF', 'BONK', 'SHIB', 'FLOKI', 'ENA',
])

export async function GET() {
  try {
    const [leaders, signals, screenerSnap] = await Promise.all([
      getForeignLeaders(10).catch(() => null),
      fetchAlphaSignals(300),
      getScreenerSnapshot().catch(() => null),
    ])

    // ── IDX (deep: 25-field screener + bandarmology) ──
    const idxItems: ConvictionItem[] = []
    if (screenerSnap?.data) {
      const rows = Object.values(screenerSnap.data)
      // Compute population stats for z-scoring (ROE, PER, momentum).
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
      // Score every stock relative to the universe, take the top 20.
      const scored = rows
        .map((r: ScreenerRow) => ({ r, ...scoreIdxRow(r, stats) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
      for (const { r, score, reasons } of scored) {
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
    // Bandarmology overlay (foreign-flow leaders)
    if (leaders) {
      for (const l of leaders.topBuy.slice(0, 5)) {
        const existing = idxItems.find((i) => i.symbol === l.code)
        if (existing) {
          existing.reasons.push({ text: `Foreign net buy leader`, weight: 0.35 })
          existing.sources.push('bandarmology')
          existing.conviction = Math.min(100, existing.conviction + 10)
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
    // Fetch additional signal sources in parallel
    const [fundingData, whaleData, smartMoneyData] = await Promise.all([
      api<{ topPairs?: Array<Record<string, unknown>> }>('/api/v1/derivatives?limit=50'),
      api<{ items?: Array<Record<string, unknown>> }>('/api/v1/whale-alert'),
      api<Array<Record<string, unknown>>>('/api/v1/smart-money?pageSize=20'),
    ])

    // Convert funding rates → signals
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

    // Convert whale alerts → signals
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

    // Convert smart money wallets → signals
    const smartWallets = smartMoneyData ?? []
    for (const sm of smartWallets) {
      const s = smartMoneyToSignal(sm as Record<string, unknown>)
      if (s) extraSignals.push(s as AlphaSignal)
    }

    // Merge new signals with alpha-feed signals
    const allSignals = [...(signals ?? []), ...extraSignals]

    const cryptoItems: ConvictionItem[] = []
    if (allSignals.length > 0) {
      // Aggregate per asset (case-insensitive), dropping non-token labels.
      const byAsset = new Map<string, AlphaSignal[]>()
      for (const s of allSignals) {
        const asset = s.asset.toUpperCase().replace(/USDT|USDC|BUSD|FDUSD$/g, '')
        // Allowlist gate: only recognized majors produce a conviction signal.
        if (!CRYPTO_ALLOWLIST.has(asset)) continue
        if (!byAsset.has(asset)) byAsset.set(asset, [])
        byAsset.get(asset)!.push(s)
      }

      // Rank by signal coverage — the assets the engine has the most evidence on.
      const ranked = [...byAsset.entries()]
        .map(([asset, sigs]) => ({ asset, sigs, conviction: scoreCrypto(sigs) }))
        .sort((a, b) => b.sigs.length - a.sigs.length)
        .slice(0, 15)

      const [thesisResults, priceMap] = await Promise.all([
        Promise.allSettled(ranked.map((r) => api<{ thesis: string }>(`/api/v1/token/thesis?symbol=${r.asset}`))),
        fetchBinancePrices(ranked.map((r) => `${r.asset}USDT`)),
      ])

      ranked.forEach((r, i) => {
        const thesis = thesisResults[i].status === 'fulfilled' ? (thesisResults[i].value?.thesis ?? null) : null
        cryptoItems.push(buildCryptoItem(r.asset, r.sigs, thesis, priceMap[`${r.asset}USDT`]))
      })
    }

    const resp = apiJson(buildResult(idxItems, cryptoItems))
    resp.headers.set('Cache-Control', 'public, max-age=30')
    return resp
  } catch {
    // Graceful empty on any unexpected error.
    return apiJson(emptyResult())
  }
}
