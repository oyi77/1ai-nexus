// ─────────────────────────────────────────────────────────────
// Exchange Flow Tracker — Whale deposit/withdrawal estimation
// Uses exchange volume + price movement as flow proxy.
// Large volume with price drop → inflow (bearish, selling).
// Large volume with price rise → outflow (bullish, holding).
// ─────────────────────────────────────────────────────────────

import { getMultiExchangeTickers, type ExchangeTicker } from '../market/multi-exchange'

// ── Types ──────────────────────────────────────────────────

export interface ExchangeFlow {
  exchange: string
  inflow: number   // estimated USD flowing INTO exchange (deposits → sell)
  outflow: number  // estimated USD flowing OUT of exchange (withdrawals → hold)
  netFlow: number  // inflow - outflow; positive = bearish
  volume24h: number
  avgPriceChange: number
  signal: 'bullish' | 'bearish' | 'neutral'
  topSymbols: string[]
}

export interface NetFlowEntry {
  exchange: string
  netFlow: number
  volume24h: number
  signal: 'bullish' | 'bearish' | 'neutral'
  flowRatio: number // outflow / inflow; >1 = bullish
  sparkHistory: number[]
}

export interface WhaleFlowEvent {
  id: string
  exchange: string
  symbol: string
  estimatedValue: number
  direction: 'deposit' | 'withdrawal'
  priceChange: number
  volume24h: number
  confidence: number
  timestamp: number
}

export interface FlowSnapshot {
  timestamp: number
  flows: ExchangeFlow[]
  totalInflow: number
  totalOutflow: number
  totalNetFlow: number
  signal: 'bullish' | 'bearish' | 'neutral'
  whaleEvents: WhaleFlowEvent[]
}

// ── Constants ──────────────────────────────────────────────

const WHALE_VOLUME_THRESHOLD = 500_000_000   // $500M+ daily volume = whale-level
const HIGH_VOLUME_SYMBOL_THRESHOLD = 100_000_000 // $100M+ per symbol = notable
const INFLOW_RATIO_ON_DROP = 0.6   // 60% of volume estimated as inflow on price drop
const OUTFLOW_RATIO_ON_RISE = 0.55 // 55% of volume estimated as outflow on price rise
const NEUTRAL_SPLIT = 0.5

// ── Flow estimation engine ─────────────────────────────────

function estimateExchangeFlow(exchange: string, tickers: ExchangeTicker[]): ExchangeFlow {
  let totalInflow = 0
  let totalOutflow = 0
  let weightedPriceChange = 0
  let totalVolume = 0
  const symbolVolumes: Array<{ symbol: string; volume: number; priceChange: number }> = []

  for (const t of tickers) {
    const vol = t.volume24h * t.price // volume in USD
    totalVolume += vol
    weightedPriceChange += t.priceChange24h * vol

    // Estimate flow direction from price change
    const drop = -t.priceChange24h
    if (drop > 2) {
      // Significant drop → heavy inflow (deposit + sell pressure)
      totalInflow += vol * INFLOW_RATIO_ON_DROP
      totalOutflow += vol * (1 - INFLOW_RATIO_ON_DROP)
    } else if (t.priceChange24h > 2) {
      // Significant rise → heavy outflow (withdraw + hold)
      totalOutflow += vol * OUTFLOW_RATIO_ON_RISE
      totalInflow += vol * (1 - OUTFLOW_RATIO_ON_RISE)
    } else {
      // Neutral range → split evenly
      totalInflow += vol * NEUTRAL_SPLIT
      totalOutflow += vol * NEUTRAL_SPLIT
    }

    symbolVolumes.push({ symbol: t.symbol, volume: vol, priceChange: t.priceChange24h })
  }

  const avgPriceChange = totalVolume > 0 ? weightedPriceChange / totalVolume : 0
  const netFlow = totalInflow - totalOutflow

  // Top symbols by volume
  const topSymbols = symbolVolumes
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5)
    .map(s => s.symbol)

  return {
    exchange,
    inflow: Math.round(totalInflow),
    outflow: Math.round(totalOutflow),
    netFlow: Math.round(netFlow),
    volume24h: Math.round(totalVolume),
    avgPriceChange: Math.round(avgPriceChange * 100) / 100,
    signal: netFlow > 0 ? 'bearish' : netFlow < 0 ? 'bullish' : 'neutral',
    topSymbols,
  }
}

function detectWhaleEvents(exchange: string, tickers: ExchangeTicker[]): WhaleFlowEvent[] {
  const events: WhaleFlowEvent[] = []

  for (const t of tickers) {
    const vol = t.volume24h * t.price
    if (vol < HIGH_VOLUME_SYMBOL_THRESHOLD) continue

    const isDrop = t.priceChange24h < -1
    const isRise = t.priceChange24h > 1
    if (!isDrop && !isRise) continue

    const confidence = Math.min(1, vol / WHALE_VOLUME_THRESHOLD)

    events.push({
      id: `${exchange}-${t.symbol}-${Date.now()}`,
      exchange,
      symbol: t.symbol,
      estimatedValue: Math.round(vol),
      direction: isDrop ? 'deposit' : 'withdrawal',
      priceChange: t.priceChange24h,
      volume24h: Math.round(vol),
      confidence: Math.round(confidence * 100) / 100,
      timestamp: Date.now(),
    })
  }

  return events.sort((a, b) => b.estimatedValue - a.estimatedValue)
}

// ── Cache ──────────────────────────────────────────────────

let cachedSnapshot: FlowSnapshot | null = null
let lastFetch = 0
const CACHE_TTL = 30_000 // 30s

async function fetchSnapshot(): Promise<FlowSnapshot> {
  const now = Date.now()
  if (cachedSnapshot && now - lastFetch < CACHE_TTL) return cachedSnapshot

  const tickersMap = await getMultiExchangeTickers(50)
  const flows: ExchangeFlow[] = []
  const allWhaleEvents: WhaleFlowEvent[] = []

  for (const [exchange, tickers] of tickersMap) {
    flows.push(estimateExchangeFlow(exchange, tickers))
    allWhaleEvents.push(...detectWhaleEvents(exchange, tickers))
  }

  // Sort whale events by estimated value descending
  allWhaleEvents.sort((a, b) => b.estimatedValue - a.estimatedValue)

  const totalInflow = flows.reduce((s, f) => s + f.inflow, 0)
  const totalOutflow = flows.reduce((s, f) => s + f.outflow, 0)
  const totalNetFlow = totalInflow - totalOutflow

  const snapshot: FlowSnapshot = {
    timestamp: now,
    flows,
    totalInflow,
    totalOutflow,
    totalNetFlow,
    signal: totalNetFlow > 0 ? 'bearish' : totalNetFlow < 0 ? 'bullish' : 'neutral',
    whaleEvents: allWhaleEvents.slice(0, 50),
  }

  cachedSnapshot = snapshot
  lastFetch = now
  return snapshot
}

// ── Sparkline history (last 20 snapshots) ──────────────────

const flowHistory: number[] = []
const MAX_HISTORY = 20

function recordHistory(netFlow: number): void {
  flowHistory.push(netFlow)
  if (flowHistory.length > MAX_HISTORY) flowHistory.shift()
}

// ── Public API ─────────────────────────────────────────────

/** Get all exchange flows with estimated inflow/outflow */
export async function getExchangeFlows(): Promise<ExchangeFlow[]> {
  const snapshot = await fetchSnapshot()
  recordHistory(snapshot.totalNetFlow)
  return snapshot.flows
}

/** Get net flow breakdown per exchange */
export async function getNetFlowByExchange(): Promise<NetFlowEntry[]> {
  const snapshot = await fetchSnapshot()
  recordHistory(snapshot.totalNetFlow)

  return snapshot.flows.map(f => ({
    exchange: f.exchange,
    netFlow: f.netFlow,
    volume24h: f.volume24h,
    signal: f.signal,
    flowRatio: f.inflow > 0 ? Math.round((f.outflow / f.inflow) * 100) / 100 : 0,
    sparkHistory: [...flowHistory],
  }))
}

/** Get large whale flow events */
export async function getWhaleFlows(): Promise<{
  events: WhaleFlowEvent[]
  summary: {
    totalDeposits: number
    totalWithdrawals: number
    netFlow: number
    signal: 'bullish' | 'bearish' | 'neutral'
    eventCount: number
  }
}> {
  const snapshot = await fetchSnapshot()
  recordHistory(snapshot.totalNetFlow)

  const deposits = snapshot.whaleEvents.filter(e => e.direction === 'deposit')
  const withdrawals = snapshot.whaleEvents.filter(e => e.direction === 'withdrawal')
  const totalDeposits = deposits.reduce((s, e) => s + e.estimatedValue, 0)
  const totalWithdrawals = withdrawals.reduce((s, e) => s + e.estimatedValue, 0)

  return {
    events: snapshot.whaleEvents,
    summary: {
      totalDeposits,
      totalWithdrawals,
      netFlow: totalDeposits - totalWithdrawals,
      signal: totalDeposits > totalWithdrawals ? 'bearish' : totalWithdrawals > totalDeposits ? 'bullish' : 'neutral',
      eventCount: snapshot.whaleEvents.length,
    },
  }
}

/** Get full flow snapshot (all data at once) */
export async function getFlowSnapshot(): Promise<FlowSnapshot & { sparkHistory: number[] }> {
  const snapshot = await fetchSnapshot()
  recordHistory(snapshot.totalNetFlow)
  return { ...snapshot, sparkHistory: [...flowHistory] }
}
