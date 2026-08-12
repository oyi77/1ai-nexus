// ─────────────────────────────────────────────────────────────
// Module: Bitget Copy-Trading Leaderboard
// sourceType: re
// upstreamProduct: Bitget copy-trading futures leaderboard dashboard
// endpoint: https://www.bitget.com/v1/trigger/public/uta/traderView
// discoveredVia: devtools-network-tab
// lastVerified: 2026-08-11
// UNOFFICIAL: this calls www.bitget.com's internal frontend API, not their public API.
//   It may break without notice if they change their dashboard.
//   fallbackFn: hyperliquid-copy-leaderboard
// Anonymous access works with Content-Type/X-Requested-With/locale/User-Agent/
// Referer/Origin. The upstream only accepts dataCycle 7/30/90/180 — any other
// value returns HTTP 429 (rate-limited), so the cycle map only emits supported
// values. Response code is the string "200" with data.rows[] of trader objects;
// metric values live in itemVoList keyed by showColumnCode, with percentColumn
// entries (profit_rate, max_retracement, winning_rate) expressed as percentages.
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'
import hyperliquidCopyModule from '../hyperliquid-copy/leaderboard'
import type { CopyTradingLeader, CopyTradingPlatform } from '../copy-trading/types'

const BITGET_LEADERBOARD_URL = 'https://www.bitget.com/v1/trigger/public/uta/traderView'

const BITGET_TTL = 180_000 // 3 min — mirrors gateio-copy-leaderboard (TOKEN_DATA × RE_MULTIPLIER)

const BITGET_HEADERS = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'locale': 'en-US',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Referer': 'https://www.bitget.com/copy-trading/futures',
  'Origin': 'https://www.bitget.com',
} as const

interface BitgetItemVo {
  colorColumn?: boolean
  comparedValue?: string | number
  percentColumn?: boolean
  showColumnCode?: string
  showColumnDesc?: string
}

interface BitgetKlinePoint {
  amount?: string | number
  dataTime?: number
}

interface BitgetTraderGrade {
  gradeId?: number
  gradeName?: string
}

interface BitgetNewLabel {
  name?: string
}

interface BitgetTraderRow {
  traderUid?: string
  traderNickName?: string
  displayName?: string
  headPic?: string | null
  followCount?: number
  maxFollowCount?: number
  itemVoList?: BitgetItemVo[]
  traderGrade?: BitgetTraderGrade | null
  newLabels?: BitgetNewLabel[]
  portfolioId?: string
  klineProfit?: { rows?: BitgetKlinePoint[] } | null
}

interface BitgetLeaderEnvelope {
  code?: string
  message?: string
  data?: {
    rows?: BitgetTraderRow[]
    maxShowSizes?: number
  }
}

/** Bitget extras beyond the shared CopyTradingLeader shape (all optional-safe). */
export interface BitgetLeader extends CopyTradingLeader {
  /** total_follow_profit — total profit of copiers following this trader. */
  copierProfit: number
  /** score — trader score, 0 when not provided. */
  score: number
  /** portfolioId — bitget copy-trading portfolio id. */
  portfolioId: string | null
  /** equityCurve — klineProfit rows (time → cumulative amount). */
  equityCurve: Array<{ amount: number; dataTime: number | null }>
}

/** Cycle keys the route accepts → upstream dataCycle (only 7/30/90/180 are served; anything else 429s). */
const BITGET_CYCLE: Record<string, number> = {
  day: 7, // 7D
  week: 30, // 30D (closest to 7D)
  month: 30, // 30D
  all: 180, // 180D — may 429
}

/** Order keys the route accepts → upstream sortRule. */
const BITGET_SORT: Record<string, number> = {
  profit: 5, // Total Profit
  win_rate: 3, // Win Rate
  aum: 9, // AUM
  profit_rate: 2, // ROI (default)
}

/** Inter-page delay for the deep per-leader scan (mirrors the OKX find pattern). */
const BITGET_PAGE_DELAY_MS = 250

function toNum(v: string | number | null | undefined): number {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeBitgetRows(rows: BitgetTraderRow[]): BitgetLeader[] {
  return rows.map(r => {
    const items = new Map<string, BitgetItemVo>()
    for (const it of r.itemVoList ?? []) {
      if (it.showColumnCode) items.set(it.showColumnCode, it)
    }
    // Raw comparedValue of an item (0 when the column is absent).
    const value = (code: string): number => toNum(items.get(code)?.comparedValue)
    // percentColumn items are percentages upstream — normalize to a ratio.
    const pct = (code: string): number => (items.get(code)?.percentColumn ? value(code) / 100 : value(code))

    return {
      id: String(r.traderUid ?? r.portfolioId ?? ''),
      platform: 'bitget' as CopyTradingPlatform,
      nick: r.traderNickName ?? r.displayName ?? `Trader ${r.traderUid ?? ''}`,
      avatar: r.headPic ?? null,
      level: r.traderGrade?.gradeId ?? 0,
      labels: [
        ...(r.traderGrade?.gradeName ? [r.traderGrade.gradeName] : []),
        ...(r.newLabels ?? []).map(l => l.name ?? '').filter(Boolean),
      ],
      profit: value('total_income'),
      profitRate: pct('profit_rate'),
      winRate: pct('winning_rate'),
      maxDrawdown: pct('max_retracement'),
      sharpe: 0, // not provided by this endpoint
      aum: value('total_follow_trade_amount'),
      followers: r.followCount ?? 0,
      maxFollowers: r.maxFollowCount ?? 0,
      leadingDays: 0, // not provided by this endpoint
      plRatio: 0, // not provided by this endpoint
      isPrivate: false,
      createTime: null, // not provided by this endpoint
      // bitget extras
      copierProfit: value('total_follow_profit'),
      score: value('score'),
      portfolioId: r.portfolioId ?? null,
      equityCurve: (r.klineProfit?.rows ?? []).map(p => ({
        amount: toNum(p.amount),
        dataTime: p.dataTime ?? null,
      })),
    }
  })
}

/** Fetch the Bitget copy-trading traderView leader list (anonymous web API). */
async function fetchBitgetList(pageSize: number, cycle: string, orderBy: string): Promise<{ leaders: BitgetLeader[]; total: number }> {
  const clamped = Math.max(1, Math.min(pageSize, 200))
  const res = await fetch(BITGET_LEADERBOARD_URL, {
    method: 'POST',
    headers: BITGET_HEADERS,
    body: JSON.stringify({
      pageNo: 1,
      pageSize: clamped,
      sortRule: BITGET_SORT[orderBy] ?? 2,
      dataCycle: BITGET_CYCLE[cycle] ?? 30,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Bitget traderView: HTTP ${res.status}`)
  const body = (await res.json()) as BitgetLeaderEnvelope
  if (body?.code !== '200') {
    throw new Error(`Bitget traderView: code ${body?.code ?? 'unknown'} (${body?.message ?? 'unknown'})`)
  }
  const rows = body.data?.rows ?? []
  return { leaders: normalizeBitgetRows(rows), total: body.data?.maxShowSizes ?? rows.length }
}

/**
 * Deep lookup for a single Bitget leader by scanning traderView pages
 * (pageNo=1..N). Upstream silently caps every page at ~20 rows even when a
 * larger pageSize is requested, so the scan is bounded by the endpoint's
 * `maxShowSizes` total over the observed rows-per-page (hard cap 200 pages).
 * Matches `traderUid` exactly, falling back to `portfolioId`. Returns `null`
 * when not found or the scan errors; consumers cache the RESULT (route-level
 * 1h TTL).
 */
export async function findBitgetLeaderById(
  leaderId: string,
  cycle: string = 'month',
): Promise<BitgetLeader | null> {
  if (!leaderId) return null
  const dataCycle = BITGET_CYCLE[cycle] ?? 30
  try {
    let pageNo = 1
    while (true) {
      const res = await fetch(BITGET_LEADERBOARD_URL, {
        method: 'POST',
        headers: BITGET_HEADERS,
        body: JSON.stringify({
          pageNo,
          pageSize: 200,
          sortRule: 2, // ROI — stable default (matches the leaderboard route)
          dataCycle,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`Bitget traderView: HTTP ${res.status}`)
      const body = (await res.json()) as BitgetLeaderEnvelope
      if (body?.code !== '200') {
        throw new Error(`Bitget traderView: code ${body?.code ?? 'unknown'} (${body?.message ?? 'unknown'})`)
      }
      const rows = body.data?.rows ?? []
      const hit = rows.find(r => String(r.traderUid) === leaderId || String(r.portfolioId) === leaderId)
      if (hit) return normalizeBitgetRows([hit])[0] ?? null

      // End of data: either we reached the total page count, or a short/empty
      // page with no total to bound against.
      const total = body.data?.maxShowSizes ?? 0
      const perPage = Math.max(rows.length, 1)
      if (total > 0) {
        if (pageNo >= Math.ceil(total / perPage)) return null
      } else if (rows.length === 0) {
        return null
      }

      pageNo++
      if (pageNo > 200) return null // hard safety cap (~4k leaders scanned)
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, BITGET_PAGE_DELAY_MS)
      await promise
    }
  } catch {
    // Graceful: transient API errors behave like "not found" for a lookup.
    return null
  }
}

async function fetchBitgetLeaderboard(params: FetchParams): Promise<{ leaders: CopyTradingLeader[]; total: number }> {
  const pageSize = Number(params.page_size ?? 50)
  const cycle = String(params.cycle ?? 'month')
  const orderBy = String(params.order_by ?? 'profit_rate')
  const { leaders, total } = await fetchBitgetList(pageSize, cycle, orderBy)
  return { leaders, total }
}

async function probeBitget(): Promise<boolean> {
  try {
    const { leaders } = await fetchBitgetList(1, 'month', 'profit_rate')
    return leaders.length > 0
  } catch {
    return false
  }
}

const bitgetCopyLeaderboardModule: DataModule = {
  id: 'bitget-copy-leaderboard',
  name: 'Bitget Copy-Trading Leaderboard',
  category: 'market',
  sourceType: 're',
  provenance: {
    describesItself: 'Bitget copy-trading leaderboard via www.bitget.com web API (anonymous)',
    upstreamProduct: 'Bitget copy-trading futures leaderboard dashboard',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-08-11',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    const ok = await probeBitget()
    const now = new Date()
    return ok
      ? { status: 'active', lastChecked: now, lastSuccess: now, failureCount: 0 }
      : { status: 'offline', lastChecked: now, failureCount: 1, notes: 'bitget traderView unreachable' }
  },

  async fallbackFn<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return hyperliquidCopyModule.fetch<T>(params)
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'bitget-copy-leaderboard',
      { ...params, platform: params.platform ?? 'bitget' },
      BITGET_TTL,
      () => fetchBitgetLeaderboard(params) as Promise<T>,
    )
  },
}

export default bitgetCopyLeaderboardModule
