// ─────────────────────────────────────────────────────────────
// Conviction Engine — Decision Layer
// Pure scoring functions (no IO, fully testable).
// Every symbol gets ONE conviction score + action + reasons.
// ─────────────────────────────────────────────────────────────

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
