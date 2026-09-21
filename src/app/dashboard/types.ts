// Dashboard page shared types + formatting helpers

// ── Intelligence hubs ──
// The dashboard is the entry point to every deep-dive surface, so the jump-off
// grid is data rather than hand-written JSX: one map() renders it, and a route
// added here can never drift out of sync with its label.

export interface MacroCountry {
  GDP?: string
  'GDP Growth'?: string
  Inflation?: string
  Unemployment?: string
  'Real Interest'?: string
  Population?: string
}

// ── Market regime (fear-greed composite) ──
export interface Regime {
  score: number
  label: string
  change: number
  state: string
  stance: string
  btcDom: number
  totalMcap: number
  mcapChange24h: number
}

// ── Cross-asset tickers ──
export interface Ticker {
  symbol: string
  price: string
  change: string
  positive: boolean
}

// ── Unified intelligence score ──
export interface IntelComponent {
  score: number
  signals: unknown[]
}

export interface IntelSignal {
  id: string
  name: string
  description: string
  direction: string
  strength: number
  timestamp: string
}

export interface IntelScore {
  overall: number
  grade: string
  regime: string
  components: Record<string, IntelComponent>
  compositeSignals: IntelSignal[]
  timestamp: string
}

// ── Per-symbol conviction ──
export interface SymbolScore {
  symbol: string
  market: string
  compositeScore: number
  direction: string
  confidence: number
}

// ── IDX alpha ideas ──
export interface IdxIdea {
  code: string
  name: string
  sector: string
  close: number
  changePct: number
  per: number | null
  pbv: number | null
  roe: number | null
  der: number | null
  dividendYield: number | null
  foreignNetStreakDays: number
  foreignNetStreakDir: string | null
  valueScore: number
  accumulationScore: number
  combinedScore: number
  alphaScore: number
  alphaVerdict: string
  alphaReasons: string[]
}

export interface NewsItem {
  id: string
  title: string
  url: string
  sourceId: string
  publishedAt: string
  category: string
  [key: string]: unknown
}

export interface DexTrending {
  name: string
  priceUsd: number
  fdv: number
  volume24h: number
  priceChange24h: number
  [key: string]: unknown
}

export interface WhaleMove {
  id: string
  amount: number
  symbol: string
  usd: number
  from: string
  to: string
  link?: string
  [key: string]: unknown
}

export interface ActivityEvent {
  id: string
  type: string
  headline: string
  asset: string
  direction: string
  strength: number
  timestamp: string
  [key: string]: unknown
}

export interface AlphaSignalCard {
  id: string
  type: string
  asset: string
  strength: number
  confidence: number
  headline: string
  explanation: string
  source: string
  timestamp: string
}

export interface ThesisCard {
  symbol: string
  thesis: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  confidence: number
  totalSignals: number
}

export interface TrendingCard {
  id: string
  title: string
  source: string
}

export interface MemeToken {
  id: string
  symbol: string
  name: string
  platform: string
  chain: string
  price: number
  change24h: number
  volume24h: number
  marketCap: number
  holders: number
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

/** Composite score → colour band, shared by every conviction surface. */
export function scoreColor(score: number): string {
  if (score >= 70) return 'text-data-bull'
  if (score >= 55) return 'text-teal-vivid'
  if (score >= 40) return 'text-data-warn'
  return 'text-data-bear'
}

export function directionGlyph(direction: string): string {
  if (direction === 'bullish') return '🟢'
  if (direction === 'bearish') return '🔴'
  return '⚪'
}

/** Greed/fear composite → regime accent. */
export function regimeAccent(score: number): string {
  if (score >= 75) return 'border-data-bull/40 bg-data-bull/5'
  if (score >= 55) return 'border-teal-vivid/40 bg-teal-vivid/5'
  if (score >= 45) return 'border-data-warn/40 bg-data-warn/5'
  return 'border-data-bear/40 bg-data-bear/5'
}
