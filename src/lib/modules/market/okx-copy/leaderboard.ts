// ─────────────────────────────────────────────────────────────
// Module: OKX Copy-Trading Leaderboard
// sourceType: re
// upstreamProduct: OKX copy-trading leaderboard web dashboard
// endpoint: https://www.okx.com/priapi/v5/ecotrade/public/follow-rank
// discoveredVia: devtools-network-tab
// lastVerified: 2026-08-12
// UNOFFICIAL: this calls www.okx.com's internal frontend API, not their public API.
//   It may break without notice if they change their dashboard.
//   fallbackFn: hyperliquid-copy-leaderboard
// Anonymous access works with the app-type/devid/x-* frontend header set and an
// empty `type` param. The upstream ignores `sort` params (the response order is
// unchanged for sort=pnl/aum/yieldRatio/winRatio), so the module client-sorts
// like gateio-copy-leaderboard. Response code is the string "0" with
// data[0].ranks[] of trader objects; winRatio/pnlRatio (aka yieldRatio) are
// ratios (0-1 / 1.31 = 131%), matching the ratio convention of the other
// leaderboard modules. normalizeOkxRows maps the full ranks payload:
// uniqueCode/pubId→id, nickName→nick, avatar/portrait→avatar,
// pnlRatio→profitRate, winRatio→winRate, totalPnl→profit,
// profitShareRatio→profitShare, copierNum→followers, asset→aum,
// maxDrawdown→maxDrawdown, tradeDays→leadingDays, sharpeRatio→sharpe,
// positionList→positions, tier/tierName→level (Bronze=1…Diamond=5),
// lever→lever, instruments→labels (instId).
// ─────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto'
import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'
import hyperliquidCopyModule from '../hyperliquid-copy/leaderboard'
import type { CopyTradingLeader, CopyTradingPlatform } from '../copy-trading/types'

const OKX_LEADERBOARD_URL = 'https://www.okx.com/priapi/v5/ecotrade/public/follow-rank'

const OKX_TTL = 180_000 // 3 min — mirrors gateio-copy-leaderboard (TOKEN_DATA × RE_MULTIPLIER)

const OKX_PAGE_DELAY_MS = 250 // small inter-page delay for sequential scans (rate-limit courtesy)

const OKX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

interface OkxInstrument {
  instId?: string
  name?: string
}

interface OkxRatePoint {
  ratio?: string | number
  statTime?: string | number
}

interface OkxTier {
  level?: string
  name?: string
  tierKey?: string
}

interface OkxRankRow {
  // leader identity
  uniqueCode?: string
  pubId?: string
  uniqueName?: string
  nickName?: string
  avatar?: string | null
  portrait?: string | null
  // performance (capture report names first, legacy names as fallback)
  pnlRatio?: string | number
  yieldRatio?: string | number
  winRatio?: string | number
  totalPnl?: string | number
  pnl?: string | number
  profitShareRatio?: string | number
  maxDrawdown?: string | number
  sharpeRatio?: string | number
  // followers / size
  copierNum?: string | number
  followerNum?: string | number
  followerLimit?: string | number
  historyFollowerNum?: string | number
  followPnl?: string | number
  asset?: string | number
  aum?: string | number
  // duration / risk / exposure
  tradeDays?: string | number
  initialDay?: string | number
  lever?: string | number
  tier?: string | OkxTier | null
  tierName?: string
  positionList?: unknown[]
  instruments?: OkxInstrument[]
  rates?: OkxRatePoint[]
}

interface OkxLeaderEnvelope {
  code?: string
  msg?: string
  data?: Array<{
    pages?: number
    ranks?: OkxRankRow[]
  }>
}

/** OKX extras beyond the shared CopyTradingLeader shape (all optional-safe). */
interface OkxLeader extends CopyTradingLeader {
  /** lever — upstream reports the leader's margin lever (can be negative). */
  lever: number
  /** tier — bronze/silver/… tier name from the leader card. */
  tier: string | null
  /** profitShare — profitShareRatio, the leader's copier profit-sharing commission (0-1). */
  profitShare: number
  /** positions — raw positionList snapshot from the leader card (shape varies upstream). */
  positions?: unknown[]
  /** equityCurve — rates rows (statTime → cumulative yield ratio). */
  equityCurve: Array<{ statTime: number; ratio: number }>
}

/** Cycle keys the route accepts → upstream latestNum (7/30/90/180D). */
const OKX_CYCLE: Record<string, number> = {
  day: 7, // 7D
  week: 30, // 30D (closest to 7D)
  month: 90, // 90D
  all: 180, // 180D
}

/** Numeric leader fields the client sort may index (all `number` in CopyTradingLeader). */
type OkxSortField = 'profit' | 'profitRate' | 'winRate' | 'aum' | 'followers' | 'leadingDays'

/** Sort keys the route accepts → client sort field (upstream ignores sort params). */
const OKX_SORTABLE: Record<string, OkxSortField> = {
  profit: 'profit',
  profit_rate: 'profitRate',
  win_rate: 'winRate',
  aum: 'aum',
  followers: 'followers',
  leading_days: 'leadingDays',
}

function toNum(v: string | number | null | undefined): number {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Map OKX tier (Bronze/Silver/Gold/…) to a numeric level (Bronze=1 … Diamond=5), preferring tier.level when present. */
function okxTierLevel(tier: string | OkxTier | null | undefined, tierName: string): number {
  if (tier && typeof tier !== 'string') {
    const explicit = toNum(tier.level)
    if (explicit > 0) return explicit
  }
  const name = (tierName || (typeof tier === 'string' ? tier : tier?.tierKey ?? '')).toLowerCase()
  if (!name) return 0
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'crown']
  const idx = order.findIndex(t => name.includes(t))
  return idx >= 0 ? idx + 1 : 0
}

/**
 * Fresh per-request headers: random devid + matching x-id-group each call.
 * x-id-group mirrors the request `t` timestamp as the web app does; the
 * literal string "undefined" for x-simulated-trading is what the captured
 * production request sent and is accepted.
 */
function buildOkxHeaders(t: number): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': OKX_UA,
    'app-type': 'web',
    'devid': randomUUID(),
    'x-site-info': '0',
    'x-locale': 'en_US',
    'x-id-group': String(t),
    'x-cdn': 'https://www.okx.com',
    'x-utc': '7',
    'x-zkdex-env': '0',
    'x-simulated-trading': 'undefined',
    'platform': 'web',
    'Referer': 'https://www.okx.com/copy-trading',
    'Origin': 'https://www.okx.com',
  }
}

function normalizeOkxRows(rows: OkxRankRow[]): OkxLeader[] {
  return rows.map(r => {
    const tierName =
      typeof r.tier === 'string' ? r.tier : (r.tier?.name ?? r.tierName ?? '')
    const instLabels = (r.instruments ?? []).map(i => i.instId ?? '').filter(Boolean)
    const id = r.uniqueCode ?? r.pubId ?? r.uniqueName ?? ''
    return {
      id,
      platform: 'okx' as CopyTradingPlatform,
      nick: r.nickName ?? `Trader ${id}`,
      avatar: r.avatar ?? r.portrait ?? null,
      level: okxTierLevel(r.tier, tierName),
      labels: [...(tierName ? [tierName] : []), ...instLabels],
      profit: toNum(r.totalPnl ?? r.pnl),
      profitRate: toNum(r.pnlRatio ?? r.yieldRatio),
      winRate: toNum(r.winRatio),
      maxDrawdown: toNum(r.maxDrawdown),
      sharpe: toNum(r.sharpeRatio),
      aum: toNum(r.asset ?? r.aum),
      followers: toNum(r.copierNum ?? r.followerNum),
      maxFollowers: toNum(r.followerLimit),
      leadingDays: toNum(r.tradeDays ?? r.initialDay),
      plRatio: 0, // not provided by this endpoint
      isPrivate: false,
      createTime: null, // not provided by this endpoint
      // okx extras
      lever: toNum(r.lever),
      tier: tierName || null,
      profitShare: toNum(r.profitShareRatio),
      positions: r.positionList && r.positionList.length > 0 ? r.positionList : undefined,
      equityCurve: (r.rates ?? []).map(p => ({
        statTime: toNum(p.statTime),
        ratio: toNum(p.ratio),
      })),
    }
  })
}

/**
 * Fetch one page of the OKX follow-rank leader list (anonymous web API).
 * `start` is 1-based; `size` is clamped to the upstream max of 20.
 */
async function fetchOkxPage(start: number, size: number, latestNum: number): Promise<{ ranks: OkxRankRow[]; pages: number }> {
  // Upstream serves a fixed page; clamp size to the probe-verified window
  // so a large page_size degrades gracefully instead of erroring.
  // Re-verified 2026-08-12: size > 20 → `51000 (Incorrect type of start, size)`.
  const clamped = Math.max(1, Math.min(size, 20))
  const t = Date.now()
  const qs = `size=${clamped}&type=&start=${start}&latestNum=${latestNum}&fullState=2&apiTrader=0&instNumLimit=4&t=${t}`

  const res = await fetch(`${OKX_LEADERBOARD_URL}?${qs}`, {
    headers: buildOkxHeaders(t),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`OKX follow-rank: HTTP ${res.status}`)
  const body = (await res.json()) as OkxLeaderEnvelope
  if (body?.code !== '0') throw new Error(`OKX follow-rank: code ${body?.code} (${body?.msg ?? 'unknown'})`)

  return {
    ranks: body.data?.[0]?.ranks ?? [],
    pages: body.data?.[0]?.pages ?? 1,
  }
}

/** Fetch the OKX copy-trading follow-rank leader list (page 1, anonymous web API). */
async function fetchOkxList(pageSize: number, cycle: string, orderBy: string): Promise<{ leaders: OkxLeader[]; total: number }> {
  const latestNum = OKX_CYCLE[cycle] ?? 90
  const { ranks, pages } = await fetchOkxPage(1, pageSize, latestNum)
  const leaders = normalizeOkxRows(ranks)

  // Upstream ignores sort params — client-sort like gateio-copy-leaderboard.
  const field = OKX_SORTABLE[orderBy] ?? 'aum'
  leaders.sort((a, b) => b[field] - a[field])

  return { leaders, total: pages }
}

/**
 * Search the paginated OKX follow-rank leaderboard for a leader by id.
 * Matches `uniqueCode` (falling back to `pubId` / `uniqueName`) across all
 * pages (start=1..pages), with a small delay between page requests.
 * Returns `null` when the leader is not found or the search errors.
 */
export async function findLeaderById(portfolioId: string, cycle: string = 'month'): Promise<OkxLeader | null> {
  if (!portfolioId) return null
  // Default cycle 'month' → OKX_CYCLE.month = 90 (30D upstream window).
  const latestNum = OKX_CYCLE[cycle] ?? 90

  try {
    const first = await fetchOkxPage(1, 20, latestNum)
    let hit = first.ranks.filter(
      r => r.uniqueCode === portfolioId || r.pubId === portfolioId || r.uniqueName === portfolioId,
    )
    if (hit.length > 0) return normalizeOkxRows(hit)[0] ?? null

    for (let start = 2; start <= first.pages; start++) {
      // Small delay between page requests to stay under OKX rate limits.
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, OKX_PAGE_DELAY_MS)
      await promise

      const page = await fetchOkxPage(start, 20, latestNum)
      hit = page.ranks.filter(
        r => r.uniqueCode === portfolioId || r.pubId === portfolioId || r.uniqueName === portfolioId,
      )
      if (hit.length > 0) return normalizeOkxRows(hit)[0] ?? null
    }

    return null
  } catch {
    // Graceful: transient API errors behave like "not found" for a lookup.
    return null
  }
}

async function fetchOkxLeaderboard(params: FetchParams): Promise<{ leaders: CopyTradingLeader[]; total: number }> {
  const pageSize = Number(params.page_size ?? 50)
  const cycle = String(params.cycle ?? 'month')
  const orderBy = String(params.order_by ?? 'aum')
  const { leaders, total } = await fetchOkxList(pageSize, cycle, orderBy)
  return { leaders, total }
}

async function probeOkx(): Promise<boolean> {
  try {
    const { leaders } = await fetchOkxList(1, 'month', 'aum')
    return leaders.length > 0
  } catch {
    return false
  }
}

const okxCopyLeaderboardModule: DataModule = {
  id: 'okx-copy-leaderboard',
  name: 'OKX Copy-Trading Leaderboard',
  category: 'market',
  sourceType: 're',
  provenance: {
    describesItself: 'OKX copy-trading leaderboard via www.okx.com priapi follow-rank web API (anonymous)',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-08-12',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    const ok = await probeOkx()
    const now = new Date()
    return ok
      ? { status: 'active', lastChecked: now, lastSuccess: now, failureCount: 0 }
      : { status: 'offline', lastChecked: now, failureCount: 1, notes: 'OKX follow-rank unreachable' }
  },

  async fallbackFn<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return hyperliquidCopyModule.fetch<T>(params)
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'okx-copy-leaderboard',
      { ...params, platform: params.platform ?? 'okx' },
      OKX_TTL,
      () => fetchOkxLeaderboard(params) as Promise<T>,
    )
  },
}

export default okxCopyLeaderboardModule
