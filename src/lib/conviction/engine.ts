// ─────────────────────────────────────────────────────────────
// Conviction Engine — Decision Layer
// Pure scoring functions (no IO, fully testable).
// Every symbol gets ONE conviction score + action + reasons.
// ─────────────────────────────────────────────────────────────

import { MACD, RSI, type OHLCV } from '@/lib/indicators'

// ── Types ──

export type ConvictionAction = 'BUY' | 'WAIT' | 'SELL'
export type ConvictionDirection = 'bull' | 'bear' | 'neutral'

export interface ConvictionReason {
  text: string
  weight: number
}

export interface ConvictionItem {
  symbol: string
  name: string
  price: number
  changePct: number
  conviction: number
  action: ConvictionAction
  direction: ConvictionDirection
  reasons: ConvictionReason[]
  sources: string[]
}

export interface ConvictionMarket {
  id: string
  label: string
  items: ConvictionItem[]
}

export interface ConvictionResult {
  generated: string
  markets: ConvictionMarket[]
}

/** Minimal structural view of an alpha signal (keeps engine IO-free). */
export interface AlphaSignalLike {
  type?: string
  asset?: string
  direction?: 'bullish' | 'bearish' | 'neutral'
  strength?: number
  confidence?: number
  headline?: string
  source?: string
  exchange?: string
}

/** IDX foreign-flow leader row consumed by the engine. */
export interface IdxLeaderLike {
  code: string
  name: string
  close: number
  changePct: number
  netVol: number
  estNetValueIdr: number
}

// ── Helpers ──

/** Type → conviction weight for crypto signals. */
const TYPE_WEIGHT: Record<string, number> = {
  whale: 0.3, // large whale transfers — high conviction on-chain evidence
  smart_money: 0.25,
  derivatives: 0.2, // funding-rate signals
  liquidation: 0.2,
  news: 0.1,
}
const DEFAULT_WEIGHT = 0.15

// ── Actions / Direction ──

export function actionFor(conviction: number): ConvictionAction {
  if (conviction >= 65) return 'BUY'
  if (conviction < 35) return 'SELL'
  return 'WAIT'
}

export function directionFor(conviction: number): ConvictionDirection {
  if (conviction >= 65) return 'bull'
  if (conviction <= 35) return 'bear'
  return 'neutral'
}

// ── IDX Scoring ──

/**
 * Conviction for an IDX foreign-flow leader.
 * topBuy:  start 50, +25 netVol>0, +15 changePct>3, +10 estNetValueIdr>1e11
 * topSell: start 50, -25 netVol<0 (reverse sign), -15 changePct<-3
 * Clamped 0-100.
 */
/**
 * Z-score a value against a reference distribution. Returns a normalized
 * -3..+3 z-score, clamped. Used to convert raw metrics into conviction
 * without any absolute threshold (which made every stock score 100).
 */
function zScore(
  value: number,
  mean: number,
  stdDev: number
): number {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || stdDev <= 0) return 0
  return Math.max(-3, Math.min(3, (value - mean) / stdDev))
}

/** Sanity-clamp outlier metrics (e.g. ROE 1470%) to a believable band. */
function clampMetric(v: number | null | undefined, lo: number, hi: number): number | null {
  if (v == null || !Number.isFinite(v)) return null
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Score an IDX stock relative to the whole universe.
 * Uses the screener's ROE/PER/momentum/leverage fields, z-scored against
 * the population so the top decile stands out and the median sits at 50.
 */
export function scoreIdxRow(
  row: {
    roe?: number | null
    per?: number | null
    change1d?: number | null
    der?: number | null
    marketCap?: number | null
  },
  stats: { roeMean: number; roeStd: number; perMean: number; perStd: number; momMean: number; momStd: number }
): { score: number; reasons: Array<{ text: string; weight: number }> } {
  // Wide clamp: allows negatives to differentiate (ROE -478 vs 0) while
  // still taming only the insane outliers (ROE 1470%).
  const roe = clampMetric(row.roe, -100, 100)
  const per = clampMetric(row.per, 0, 100)
  const momentum = clampMetric(row.change1d, -30, 30)

  let score = 50
  const reasons: Array<{ text: string; weight: number }> = []

  // ROE z-score: strong profitability pushes conviction up.
  if (roe != null) {
    const z = zScore(roe, stats.roeMean, stats.roeStd)
    score += z * 10
    if (z > 1) reasons.push({ text: `ROE ${roe.toFixed(1)}% — top-tier profitability`, weight: 0.3 })
    else if (z > 0.5) reasons.push({ text: `ROE ${roe.toFixed(1)}% — above median`, weight: 0.2 })
    else if (roe < 0) reasons.push({ text: `ROE ${roe.toFixed(1)}% — loss-making`, weight: 0.3 })
  }

  // PER z-score: cheap (low PER) pushes up, expensive pushes down.
  if (per != null && per > 0) {
    const z = zScore(per, stats.perMean, stats.perStd)
    score += -z * 7 // low PER (below mean) = cheap, adds conviction
    if (z < -1) reasons.push({ text: `PER ${per.toFixed(1)}x — undervalued`, weight: 0.25 })
    else if (z < -0.5) reasons.push({ text: `PER ${per.toFixed(1)}x — attractive`, weight: 0.15 })
  }

  // Momentum z-score: today's move relative to the universe.
  if (momentum != null) {
    const z = zScore(momentum, stats.momMean, stats.momStd)
    score += z * 6
    if (z > 1) reasons.push({ text: `Price +${momentum.toFixed(1)}% — strong momentum`, weight: 0.3 })
    else if (z < -1) reasons.push({ text: `Price ${momentum.toFixed(1)}% — distribution`, weight: 0.25 })
  }

  // Leverage: low DER (healthy balance sheet) is a mild positive.
  if (row.der != null && row.der > 0 && row.der < 1) {
    score += 4
    reasons.push({ text: `DER ${row.der.toFixed(2)} — low leverage`, weight: 0.15 })
  }

  return { score: Math.max(0, Math.min(100, score)), reasons }
}

/** Backward-compat wrapper kept for existing bandarmology tests. */
export function scoreIdx(
  item: Pick<IdxLeaderLike, 'netVol' | 'changePct' | 'estNetValueIdr'>,
  side: 'buy' | 'sell',
): number {
  let score = 50
  if (side === 'buy') {
    if (item.netVol > 0) score += 25
    if (item.changePct > 3) score += 15
    if (item.estNetValueIdr > 1e11) score += 10
  } else {
    if (item.netVol < 0) score -= 25
    if (item.changePct < -3) score -= 15
  }
  return Math.max(0, Math.min(100, score))
}

// ── Crypto Scoring ──

/** Weighted contribution of one signal: sign(±1/0) × strength/100 × confidence × type weight. */
function weightedContribution(s: AlphaSignalLike): number {
  const sign = s.direction === 'bullish' ? 1 : s.direction === 'bearish' ? -1 : 0
  const contribution = (sign * (s.strength ?? 0)) / 100 * (s.confidence ?? 0)
  return contribution * (TYPE_WEIGHT[s.type ?? ''] ?? DEFAULT_WEIGHT)
}

// ── Signal Source Conversions ──
// Pure functions that convert external data shapes into AlphaSignalLike
// for the conviction engine. No IO — fully testable.

interface FundingInput {
  symbol: string
  fundingRate: number
  exchange?: string
  [key: string]: unknown
}

interface WhaleAlertInput {
  amount: number
  symbol: string
  usd: number
  from: string
  to: string
  [key: string]: unknown
}

interface SmartMoneyInput {
  wallet?: {
    entity?: {
      name?: string
      type?: string
      totalUsdValue?: number
      verified?: boolean
    }
  }
  [key: string]: unknown
}

const EXCHANGE_KEYWORDS = ['binance', 'coinbase', 'kraken', 'okx', 'bybit', 'bitfinex', 'huobi', 'gate', 'kucoin', 'bitget']

function inferWhaleDirection(from: string, to: string): 'bullish' | 'bearish' | 'neutral' {
  const fromLower = from.toLowerCase()
  const toLower = to.toLowerCase()
  const fromEx = EXCHANGE_KEYWORDS.some(k => fromLower.includes(k))
  const toEx = EXCHANGE_KEYWORDS.some(k => toLower.includes(k))
  // To exchange → potential sell (bearish). From exchange → potential buy (bullish).
  if (toEx && !fromEx) return 'bearish'
  if (fromEx && !toEx) return 'bullish'
  return 'neutral'
}

/** Normalize entity names to symbols for smart-money mapping. */
const ENTITY_TO_SYMBOL: Record<string, string> = {
  bitcoin: 'BTC', ethereum: 'ETH', tether: 'USDT', 'usd coin': 'USDC',
  binance: 'BNB', ripple: 'XRP', solana: 'SOL', dogecoin: 'DOGE',
  cardano: 'ADA', polkadot: 'DOT', litecoin: 'LTC', chainlink: 'LINK',
  avalanche: 'AVAX', polygon: 'MATIC', uniswap: 'UNI', aave: 'AAVE',
}

/** Funding rate → signal. Positive funding → bullish, negative → bearish. Weight via TYPE_WEIGHT.derivatives (0.2). */
export function fundingToSignal(f: FundingInput): AlphaSignalLike | null {
  const rate = f.fundingRate
  if (Math.abs(rate) < 0.0001) return null
  const asset = f.symbol.replace(/USDT|USD|SWAP|[-]/g, '').trim()
  if (!asset) return null
  return {
    type: 'derivatives',
    asset,
    direction: rate > 0 ? 'bullish' : 'bearish',
    strength: Math.min(100, Math.round(Math.abs(rate) * 50000)),
    confidence: 0.6,
    headline: `💰 Funding ${(rate * 100).toFixed(4)}% — ${rate > 0 ? 'longs pay shorts' : 'shorts pay longs'}`,
    source: 'funding',
    exchange: f.exchange,
  }
}

/** Whale transfer → signal. To exchange → bearish, from exchange → bullish. Weight via TYPE_WEIGHT.whale (0.35). */
export function whaleToSignal(w: WhaleAlertInput): AlphaSignalLike | null {
  if (w.usd < 500_000 || !w.symbol) return null
  const direction = inferWhaleDirection(w.from, w.to)
  return {
    type: 'whale',
    asset: w.symbol.toUpperCase(),
    direction,
    strength: Math.min(100, Math.round(w.usd / 1_000_000)),
    confidence: 0.7,
    headline: `🐋 ${w.amount.toFixed(2)} ${w.symbol} ($${(w.usd / 1e6).toFixed(1)}M) ${w.from} → ${w.to}`,
    source: 'whale-alert',
  }
}

/** Smart money wallet → signal. Top wallets signal accumulation → bullish. Weight via TYPE_WEIGHT.smart_money (0.25). */
export function smartMoneyToSignal(s: SmartMoneyInput): AlphaSignalLike | null {
  const entity = s.wallet?.entity
  if (!entity?.name) return null
  const lower = entity.name.toLowerCase()
  const asset = ENTITY_TO_SYMBOL[lower] ?? entity.name.toUpperCase()
  return {
    type: 'smart_money',
    asset,
    direction: 'bullish',
    strength: Math.min(100, Math.round((entity.totalUsdValue ?? 0) / 1_000_000)),
    confidence: 0.65,
    headline: `🧠 Smart Money: ${entity.type || 'wallet'} ${entity.name} ($${((entity.totalUsdValue ?? 0) / 1e6).toFixed(1)}M)`,
    source: 'smartmoney',
  }
}


/**
 * Conviction from aggregated alpha signals for one asset.
 * Each signal contributes direction(±1/0) × strength/100 × confidence,
 * weighted by signal type. conviction = 50 + (weightedSum × 100), clamped 0-100.
 * Thesis (BULLISH/BEARISH/NEUTRAL) adds ±10 weighted 0.3.
 */
export function scoreCrypto(signals: AlphaSignalLike[], thesis?: string | null): number {
  let weightedSum = 0
  for (const s of signals) {
    weightedSum += weightedContribution(s)
  }
  let conviction = 50 + weightedSum * 100
  if (thesis) {
    const delta = thesis === 'BULLISH' ? 10 : thesis === 'BEARISH' ? -10 : 0
    conviction += delta * 0.3
  }
  return Math.max(0, Math.min(100, conviction))
}

// ── Technical Scoring ──

/**
 * Technical conviction delta from RSI + MACD.
 * RSI(14): <30 oversold (bullish +), >70 overbought (bearish -), else neutral.
 * MACD: macd line above signal line → bullish, below → bearish.
 * Returns a clamped [-20, +20] score delta + reasons, so technical conviction
 * ADDS TO the fundamental score without ever overruling it.
 */
export function scoreTechnical(
  ohlcv: OHLCV[],
): { scoreDelta: number; reasons: Array<{ text: string; weight: number }> } {
  const reasons: Array<{ text: string; weight: number }> = []
  if (!ohlcv || ohlcv.length === 0) return { scoreDelta: 0, reasons }

  let delta = 0

  // RSI(14) — last non-null value.
  const rsiSeries = RSI(ohlcv, 14)
  const rsi = lastIndicatorValue(rsiSeries)
  if (rsi != null) {
    if (rsi < 30) {
      delta += 10
      reasons.push({ text: `RSI ${rsi.toFixed(1)} — oversold, relief-bounce potential`, weight: 0.2 })
    } else if (rsi > 70) {
      delta -= 10
      reasons.push({ text: `RSI ${rsi.toFixed(1)} — overbought, pullback risk`, weight: 0.2 })
    }
  }

  // MACD — macd line vs signal line (last non-null pair).
  const { macd, signal } = MACD(ohlcv)
  const macdVal = lastIndicatorValue(macd)
  const signalVal = lastIndicatorValue(signal)
  if (macdVal != null && signalVal != null) {
    if (macdVal > signalVal) {
      delta += 8
      reasons.push({ text: 'MACD above signal — bullish momentum', weight: 0.15 })
    } else if (macdVal < signalVal) {
      delta -= 8
      reasons.push({ text: 'MACD below signal — bearish momentum', weight: 0.15 })
    }
  }

  return {
    scoreDelta: Math.max(-20, Math.min(20, delta)),
    reasons,
  }
}

/** Last non-null (and finite) `.value` from an indicator series, or undefined. */
function lastIndicatorValue(points: Array<{ value: number }>): number | undefined {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i].value
    if (v != null && Number.isFinite(v)) return v
  }
  return undefined
}

// ── Reason Builders ──

/** Sort candidates by weight desc and take the top N. */
export function buildReasons(candidates: ConvictionReason[], topN = 4): ConvictionReason[] {
  return [...candidates]
    .filter((r) => r.text.length > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, topN)
}

/** IDX leader reasons from netVol direction + changePct + estNetValueIdr. */
export function idxReasons(
  item: Pick<IdxLeaderLike, 'netVol' | 'changePct' | 'estNetValueIdr'>,
  side: 'buy' | 'sell',
): ConvictionReason[] {
  const reasons: ConvictionReason[] = []
  const netValB = Math.abs(item.estNetValueIdr) / 1e9

  if (side === 'buy') {
    if (item.netVol > 0) {
      reasons.push({
        text: `Foreign net buy ${item.netVol.toLocaleString('en')} shares (est Rp${netValB.toFixed(1)}B)`,
        weight: 0.4,
      })
    }
    if (item.changePct > 3) {
      reasons.push({
        text: `Price +${item.changePct.toFixed(1)}% on foreign accumulation`,
        weight: 0.3,
      })
    }
    if (item.estNetValueIdr > 1e11) {
      reasons.push({ text: `Large foreign value inflow (est Rp${netValB.toFixed(0)}B)`, weight: 0.2 })
    }
  } else {
    if (item.netVol < 0) {
      reasons.push({
        text: `Foreign net sell ${Math.abs(item.netVol).toLocaleString('en')} shares (est Rp${netValB.toFixed(1)}B)`,
        weight: 0.4,
      })
    }
    if (item.changePct < -3) {
      reasons.push({
        text: `Price ${item.changePct.toFixed(1)}% on foreign distribution`,
        weight: 0.3,
      })
    }
  }
  return buildReasons(reasons)
}

/** Top crypto reasons by |weighted contribution| per signal. */
export function cryptoReasons(signals: AlphaSignalLike[], topN = 3): ConvictionReason[] {
  const candidates = signals
    .map((s) => ({ text: s.headline ?? '', weight: Math.abs(weightedContribution(s)) }))
    .filter((r) => r.weight > 0)
  return buildReasons(candidates, topN)
}

// ── Item Builders ──

/** Common asset display names for crypto. */
const ASSET_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BNB',
  XRP: 'Ripple',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  DOT: 'Polkadot',
  MATIC: 'Polygon',
  UNI: 'Uniswap',
  ATOM: 'Cosmos',
  LTC: 'Litecoin',
  BCH: 'Bitcoin Cash',
}

export function assetName(symbol: string): string {
  return ASSET_NAMES[symbol.toUpperCase()] ?? symbol.toUpperCase()
}

/** Map a single alpha signal type to a public source chip label. */
export function sourceLabel(type?: string): string {
  switch (type) {
    case 'whale':
      return 'whale'
    case 'smart_money':
      return 'smart-money'
    case 'derivatives':
      return 'funding'
    case 'liquidation':
      return 'liquidation'
    case 'news':
      return 'news'
    case 'insider':
      return 'insider'
    case 'exchange_flow':
      return 'exchange-flow'
    default:
      return type ?? 'alpha'
  }
}

export function buildIdxItem(leader: IdxLeaderLike, side: 'buy' | 'sell'): ConvictionItem {
  const conviction = scoreIdx(leader, side)
  return {
    symbol: leader.code,
    name: leader.name,
    price: leader.close,
    changePct: leader.changePct,
    conviction,
    action: actionFor(conviction),
    direction: directionFor(conviction),
    reasons: idxReasons(leader, side),
    sources: ['bandarmology'],
  }
}

export function buildCryptoItem(
  symbol: string,
  signals: AlphaSignalLike[],
  thesis?: string | null,
  price?: { price: number; changePct: number },
): ConvictionItem {
  const conviction = scoreCrypto(signals, thesis)
  const seen: Record<string, true> = { alpha: true }
  for (const s of signals) seen[sourceLabel(s.type)] = true
  if (thesis) seen.thesis = true

  return {
    symbol: symbol.toUpperCase(),
    name: assetName(symbol),
    price: price?.price ?? 0,
    changePct: price?.changePct ?? 0,
    conviction,
    action: actionFor(conviction),
    direction: directionFor(conviction),
    reasons: cryptoReasons(signals),
    sources: Object.keys(seen),
  }
}

// ── Result Builder ──

export function buildResult(idxItems: ConvictionItem[], cryptoItems: ConvictionItem[]): ConvictionResult {
  return {
    generated: new Date().toISOString(),
    markets: [
      { id: 'IDX', label: 'Indonesia Equities', items: idxItems },
      { id: 'CRYPTO', label: 'Crypto', items: cryptoItems },
    ],
  }
}

/** Graceful empty payload used when sources are unavailable. */
export function emptyResult(): ConvictionResult {
  return {
    generated: new Date().toISOString(),
    markets: [],
  }
}
