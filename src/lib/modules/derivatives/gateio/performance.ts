/**
 * Module: Gate.io Copy-Trading Leader Performance Intelligence
 * sourceType: re
 * upstreamProduct: gate.com copy-trading leader analytics
 * endpoint: gate.com frontend API (copy-leader endpoints)
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-08-11
 * UNOFFICIAL: this calls gate.com's internal frontend API, not a documented
 *   public API. It may break without notice if their frontend changes.
 *   Akamai rate-limits after ~6 rapid requests (HTTP 403 "Access Denied").
 *   Space requests out; the module caches per section (90s) to absorb bursts.
 *   fallbackFn: empty per-section shape (graceful degradation, never 502).
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'

const MODULE_ID = 'gateio-performance'
const GATEIO_TTL = TTL.DERIVATIVES * TTL.RE_MULTIPLIER // 30s × 3 = 90s

const BASE = 'https://www.gate.com'

// Reverse-engineered request recipe: full browser headers + HTTP/2 + gzip.
// No auth/cookies needed for the copy-trading leader endpoints.
const GATEIO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'x-sub-website-id': '0',
  Referer: 'https://www.gate.com/',
} as const

const profileUrl = (id: string | number) =>
  `${BASE}/api/copytrade/copy_trading/trader/detail/${id}?leaderId=${id}&sub_website_id=0`
const equityUrl = (id: string | number) =>
  `${BASE}/apiw/v2/copy/leader/profit_chart?leader_id=${id}&data_type=month&sub_website_id=0`
const marketsUrl = (id: string | number) =>
  `${BASE}/api/copytrade/copy_trading/trader/position_composition?leader_id=${id}&data_type=month&sub_website_id=0`
const tradesUrl = (id: string | number) =>
  `${BASE}/apiw/v2/copy/api/leader/trading_view?leader_id=${id}&data_day=0&sub_website_id=0`

// ── Raw payload shapes (reverse-engineered) ────────────────────────────────

interface GateioMarketRaw {
  market: string
  engine_type: string
  settle: string
  max_leverage: string | number
}

interface GateioTraderDetail {
  data: {
    config: {
      leader_id: number
      level: number
      status: string
      style: string
      abstract?: string
      abstract_en?: string
      follow_fee_rate: string
      min_follow_amount: string
      max_follow_amount: string
      markets?: GateioMarketRaw[]
      user_info: {
        nickname: string
        nick?: string
        avatar?: string
        tier?: number
        hide_name?: string
        anonymous?: boolean
      }
    }
    profit: {
      trade_num: number
      win_num: number
      loss_num: number
      total_invest?: string
      profit?: string
      profit_rate?: string
      aum?: string
      max_drawdown?: string
      sharp_ratio?: string
      unrealised_pnl?: string
      follow_profit?: string
      curr_follow_num?: number
      max_follow_num?: number
      seven_profit?: string
      seven_profit_rate?: string
      last_trade_time?: number
    }
  }
}

interface GateioProfitPointRaw {
  profit: string
  profit_rate: string
  current_profit: string
  total_invest: string
  liq?: { tag: boolean }
  reset?: { tag: boolean }
  create_time: number
}

interface GateioProfitChart {
  data: { list?: GateioProfitPointRaw[] }
}

interface GateioMarketRawRow {
  market: string
  percent: number
  count: number
  pnl_sum: string
}

interface GateioPositions {
  data?: GateioMarketRawRow[]
}

interface GateioTradeRawRow {
  market: string
  profit: string
  hold_position_time: number
  data_time: string | number
}

interface GateioTradingView {
  data: { trading_view?: GateioTradeRawRow[] }
}

// ── Clean output shapes ────────────────────────────────────────────────────

export interface GateioEquityPoint {
  profit: number
  profitRate: number
  currentProfit: number
  totalInvest: number
  liqTag: boolean
  resetTag: boolean
  timestamp: number
}

export interface GateioMarketConcentration {
  symbol: string
  percent: number // 0..1 fraction (display as %)
  count: number
  pnl: number
}

export type GateioTrade = {
  market: string
  profit: number
  holdSeconds: number
  timestamp: number
}

export interface GateioMarketConfig {
  symbol: string
  engineType: string
  settle: string
  maxLeverage: number
}

export interface GateioLeaderStats {
  tradeNum: number
  winNum: number
  lossNum: number
  winRate: number // 0..1
  totalInvest: number
  profit: number
  profitRate: number
  aum: number
  maxDrawdown: number // 0..1
  sharpRatio: number
  followProfit: number
  currFollowNum: number
  maxFollowNum: number
  unrealisedPnl: number
  sevenProfit: number
  sevenProfitRate: number
  lastTradeTime: number
}

export interface GateioLeaderProfile {
  id: number
  nickname: string
  nick: string
  avatar: string
  tier: number
  hideName: string
  status: string
  style: string
  abstract: string
  level: number
  feeRate: number
  minFollow: number
  maxFollow: number
  markets: GateioMarketConfig[]
  stats: GateioLeaderStats
}

export interface GateioPerformanceData {
  profile: GateioLeaderProfile | null
  equity: GateioEquityPoint[]
  markets: GateioMarketConcentration[]
  trades: GateioTrade[]
}

// ── Normalizers (coerce gate.com string numbers) ─────────────────────────

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizeProfile(raw: GateioTraderDetail): GateioLeaderProfile | null {
  const config = raw?.data?.config
  const profit = raw?.data?.profit
  const user = config?.user_info
  if (!config || !profit || !user) return null
  const tradeNum = toNum(profit.trade_num)
  const winNum = toNum(profit.win_num)
  const lossNum = toNum(profit.loss_num)
  return {
    id: toNum(config.leader_id),
    nickname: user.nickname ?? '',
    nick: user.nick ?? '',
    avatar: user.avatar ?? '',
    tier: toNum(user.tier),
    hideName: user.hide_name ?? '',
    status: config.status ?? 'unknown',
    style: config.style ?? '',
    abstract: config.abstract ?? config.abstract_en ?? '',
    level: toNum(config.level),
    feeRate: toNum(config.follow_fee_rate),
    minFollow: toNum(config.min_follow_amount),
    maxFollow: toNum(config.max_follow_amount),
    markets: Array.isArray(config.markets)
      ? config.markets.slice(0, 20).map((m) => ({
          symbol: m.market,
          engineType: m.engine_type,
          settle: m.settle,
          maxLeverage: toNum(m.max_leverage),
        }))
      : [],
    stats: {
      tradeNum,
      winNum,
      lossNum,
      winRate: tradeNum > 0 ? winNum / tradeNum : 0,
      totalInvest: toNum(profit.total_invest),
      profit: toNum(profit.profit),
      profitRate: toNum(profit.profit_rate),
      aum: toNum(profit.aum),
      maxDrawdown: toNum(profit.max_drawdown),
      sharpRatio: toNum(profit.sharp_ratio),
      followProfit: toNum(profit.follow_profit),
      currFollowNum: toNum(profit.curr_follow_num),
      maxFollowNum: toNum(profit.max_follow_num),
      unrealisedPnl: toNum(profit.unrealised_pnl),
      sevenProfit: toNum(profit.seven_profit),
      sevenProfitRate: toNum(profit.seven_profit_rate),
      lastTradeTime: toNum(profit.last_trade_time),
    },
  }
}

function normalizeEquity(raw: GateioProfitChart): GateioEquityPoint[] {
  const list = raw?.data?.list
  if (!Array.isArray(list)) return []
  return list.map((p) => ({
    profit: toNum(p.profit),
    profitRate: toNum(p.profit_rate),
    currentProfit: toNum(p.current_profit),
    totalInvest: toNum(p.total_invest),
    liqTag: Boolean(p.liq?.tag),
    resetTag: Boolean(p.reset?.tag),
    timestamp: toNum(p.create_time),
  }))
}

function normalizeMarkets(raw: GateioPositions): GateioMarketConcentration[] {
  const list = raw?.data
  if (!Array.isArray(list)) return []
  return list.map((m) => ({
    symbol: String(m.market ?? ''),
    percent: toNum(m.percent),
    count: toNum(m.count),
    pnl: toNum(m.pnl_sum),
  }))
}

function normalizeTrades(raw: GateioTradingView): GateioTrade[] {
  const list = raw?.data?.trading_view
  if (!Array.isArray(list)) return []
  return list.map((t) => ({
    market: String(t.market ?? ''),
    profit: toNum(t.profit),
    holdSeconds: toNum(t.hold_position_time),
    timestamp: toNum(t.data_time),
  }))
}

// ── Transport ──────────────────────────────────────────────────────────────

async function gateioGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: GATEIO_HEADERS,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Gate.io ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

// ── Module ─────────────────────────────────────────────────────────────────

const gateioPerformanceModule: DataModule = {
  id: MODULE_ID,
  name: 'Gate.io Copy Leader Performance',
  category: 'derivatives',
  sourceType: 're',
  provenance: {
    describesItself:
      'Per-leader copy-trading performance intelligence from gate.com: profit curve, position concentration, recent trades, and full risk/stat profile.',
    upstreamProduct: 'gate.com copy-trading leader analytics',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-08-11',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await gateioGet(profileUrl('30809'))
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (err) {
      return {
        status: 'degraded',
        lastChecked: new Date(),
        failureCount: 1,
        notes: err instanceof Error ? err.message : 'gate.com profile endpoint unreachable',
      }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const id = String(params.leaderId ?? params.leader_id ?? '')
    if (!id) throw new Error('Gate.io performance: leaderId required')

    const data: GateioPerformanceData = { profile: null, equity: [], markets: [], trades: [] }
    let anyCached = false

    // Each section fetches independently with its own cache key; one section
    // failing (e.g. Akamai 403 mid-burst) leaves that section empty instead of
    // failing the whole aggregate.
    const sections = [
      {
        name: 'profile',
        run: () =>
          cachedFetch<GateioTraderDetail>(MODULE_ID, { ...params, section: 'profile' }, GATEIO_TTL, () =>
            gateioGet<GateioTraderDetail>(profileUrl(id)),
          ),
        apply: (r: ModuleResult<unknown>) => {
          data.profile = normalizeProfile(r.data as GateioTraderDetail)
        },
      },
      {
        name: 'equity',
        run: () =>
          cachedFetch<GateioProfitChart>(MODULE_ID, { ...params, section: 'equity' }, GATEIO_TTL, () =>
            gateioGet<GateioProfitChart>(equityUrl(id)),
          ),
        apply: (r: ModuleResult<unknown>) => {
          data.equity = normalizeEquity(r.data as GateioProfitChart)
        },
      },
      {
        name: 'markets',
        run: () =>
          cachedFetch<GateioPositions>(MODULE_ID, { ...params, section: 'markets' }, GATEIO_TTL, () =>
            gateioGet<GateioPositions>(marketsUrl(id)),
          ),
        apply: (r: ModuleResult<unknown>) => {
          data.markets = normalizeMarkets(r.data as GateioPositions)
        },
      },
      {
        name: 'trades',
        run: () =>
          cachedFetch<GateioTradingView>(MODULE_ID, { ...params, section: 'trades' }, GATEIO_TTL, () =>
            gateioGet<GateioTradingView>(tradesUrl(id)),
          ),
        apply: (r: ModuleResult<unknown>) => {
          data.trades = normalizeTrades(r.data as GateioTradingView)
        },
      },
    ]

    await Promise.all(
      sections.map((s) =>
        s
          .run()
          .then((r) => {
            anyCached = anyCached || r.cached
            s.apply(r)
          })
          .catch(() => {
            // Section stays at its empty default — never 502 the whole request.
          }),
      ),
    )

    return {
      data: data as unknown as T,
      source: MODULE_ID,
      cached: anyCached,
      timestamp: Date.now(),
      ttl: GATEIO_TTL,
    }
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: { profile: null, equity: [], markets: [], trades: [] } as unknown as T,
      source: 'gateio-performance (fallback)',
      cached: true,
      timestamp: Date.now(),
      ttl: GATEIO_TTL,
    }
  },
}

export default gateioPerformanceModule