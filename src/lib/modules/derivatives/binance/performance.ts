/**
 * Module: Binance Copy-Trading Leader Performance
 * sourceType: re
 * upstreamProduct: Binance Futures copy-trading leader detail dashboard
 * endpoints: lead-portfolio/detail, lead-portfolio/chart-data,
 *   lead-portfolio/performance/coin, lead-data/positions, spot-futures-last-lead
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-08-12
 * UNOFFICIAL: this calls binance.com's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: empty per-section shape (graceful degradation, never 502).
 * Anonymous access works (fresh bnc-uuid + fresh device-info per request) like
 * the sibling binance-copy-leaderboard module; a fresh device fingerprint
 * avoids triggering the AWS WAF challenge.
 * Units: binance reports percentages as raw values (37.02 = 37.02%). All
 * percentage fields (roi, profitSharingRatio) are normalized to 0-1 fractions
 * here to match the binance-copy-leaderboard convention (winRate/roi /100).
 */

import { randomUUID } from 'crypto'
import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'

const MODULE_ID = 'binance-performance'
const BINANCE_TTL = TTL.DERIVATIVES * TTL.RE_MULTIPLIER // 30s × 3 = 90s

const BINANCE_BASE = 'https://www.binance.com'

const BINANCE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

// Real Chrome brand string — never the HeadlessChrome token that trips Binance's AWS WAF.
const BINANCE_SEC_CH_UA = '"Google Chrome";v="127", "Chromium";v="127", "Not)A;Brand";v="24"'

// Sample portfolioId used only by healthCheck (captured from the live detail page).
const PROBE_PORTFOLIO_ID = '5142214769055593984'

const TIME_RANGES = ['7D', '30D', '90D', '180D', 'ALL'] as const

const profileUrl = (id: string | number) =>
  `${BINANCE_BASE}/bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/detail?portfolioId=${id}`
const chartUrl = (id: string | number, dataType: string, timeRange: string) =>
  `${BINANCE_BASE}/bapi/futures/v1/public/future/copy-trade/lead-portfolio/chart-data?portfolioId=${id}&dataType=${dataType}&timeRange=${timeRange}`
const marketsUrl = (id: string | number, timeRange: string) =>
  `${BINANCE_BASE}/bapi/futures/v1/public/future/copy-trade/lead-portfolio/performance/coin?portfolioId=${id}&timeRange=${timeRange}`
const positionsUrl = (id: string | number) =>
  `${BINANCE_BASE}/bapi/futures/v1/friendly/future/copy-trade/lead-data/positions?portfolioId=${id}`
const statusUrl = (id: string | number) =>
  `${BINANCE_BASE}/bapi/futures/v1/friendly/future/spot-copy-trade/common/spot-futures-last-lead?portfolioId=${id}`

// ── Raw payload shapes (reverse-engineered from captured responses) ─────────

/** bapi envelope: { code: '000000', message, messageDetail, data, success } */
interface BinanceEnvelope {
  code?: string
  message?: string | null
  data?: unknown
  success?: boolean
}

/** lead-portfolio/detail — data is the flat leader profile object. */
interface BinanceDetailEnvelope extends BinanceEnvelope {
  data?: {
    leadPortfolioId?: string
    nickname?: string
    nicknameTranslate?: string | null
    avatarUrl?: string | null
    status?: string
    description?: string | null
    descTranslate?: string | null
    aumAmount?: string | number
    marginBalance?: string | number
    copierPnl?: string | number
    profitSharingRate?: string | number
    sharpRatio?: string | number | null
    startTime?: number | null
    lastTradeTime?: number | null
    currentCopyCount?: number
    maxCopyCount?: number
    totalCopyCount?: number
    mockCopyCount?: number
    initInvestAsset?: string
    futuresType?: string
    favoriteCount?: number
    badgeName?: string | null
    aiSummary?: string | null
    tag?: string[]
    tagItemVos?: Array<{ tagName?: string }>
  }
}

/** lead-portfolio/chart-data — data is a flat list of {value, dataType, dateTime}. */
interface BinanceChartPoint {
  value?: number
  dataType?: string
  dateTime?: number
}
interface BinanceChartEnvelope extends BinanceEnvelope {
  data?: BinanceChartPoint[]
}

/** lead-portfolio/performance/coin — data.data is [{asset, volume}]. */
interface BinanceCoinEnvelope extends BinanceEnvelope {
  data?: {
    timeRange?: string
    updateTime?: number
    data?: Array<{ asset?: string; volume?: string | number }>
  }
}

/** lead-data/positions — data is a list of open positions (shape from UI capture). */
interface BinancePositionRaw {
  symbol?: string
  asset?: string
  entryPrice?: string | number
  markPrice?: string | number
  unrealizedProfit?: string | number
  pnl?: string | number
  roe?: string | number
  pnlPercent?: string | number
  leverage?: string | number
  marginType?: string
  marginMode?: string
}
interface BinancePositionsEnvelope extends BinanceEnvelope {
  data?: BinancePositionRaw[]
}

/** spot-futures-last-lead — data carries public/private lead status across spot+futures. */
interface BinanceStatusEnvelope extends BinanceEnvelope {
  data?: {
    futuresPublicLPStatus?: string | null
    spotPublicLPStatus?: string | null
  }
}

// ── Clean output shapes ─────────────────────────────────────────────────────

export interface BinanceEquityPoint {
  timestamp: number // ms epoch (dateTime)
  roi: number | null // 0-1 fraction (raw % /100); null when the ROI axis failed
  pnl: number | null // raw USD; null when the PNL axis failed
}

export interface BinanceMarketConcentration {
  symbol: string // asset (e.g. ETH)
  volume: number // traded volume share as reported by the coin endpoint
}

export interface BinancePosition {
  symbol: string
  entryPrice: number | null
  markPrice: number | null
  pnl: number | null
  roe: number | null
  leverage: number | null
  marginMode: string | null
}

export interface BinanceLeaderProfile {
  id: string
  nickName: string
  nickNameTranslate: string | null
  avatar: string | null
  status: string | null
  description: string | null
  roi: number | null // backfilled from the ROI chart's latest point (0-1)
  pnl: number | null // copierPnl (USD)
  aum: number | null // aumAmount (USD)
  marginBalance: number | null // USD
  maxDrawdown: number | null // not exposed by these endpoints
  sharpeRatio: number | null // sharpRatio
  winRate: number | null // not exposed by these endpoints
  profitSharingRatio: number | null // 0-1 fraction (profitSharingRate % /100)
  followerNum: number | null // currentCopyCount
  maxCopyCount: number | null
  totalCopyCount: number | null
  mockCopyCount: number | null
  asset: string | null // initInvestAsset (e.g. USDT)
  tradeDays: number | null // computed from startTime
  startTime: number | null
  lastTradeTime: number | null
  futuresType: string | null // e.g. UM
  tags: string[] // tagItemVos/tag names (e.g. HIGH_LEVERAGE, TradFi)
  badgeName: string | null
  aiSummary: string | null
  favoriteCount: number | null
  futuresStatus: string | null // spot-futures-last-lead enrichment
  spotStatus: string | null // spot-futures-last-lead enrichment
}

export interface BinancePerformanceData {
  profile: BinanceLeaderProfile | null
  equity: BinanceEquityPoint[]
  markets: BinanceMarketConcentration[]
  positions: BinancePosition[]
  trades: never[] // not exposed by these endpoints
}

// ── Coercion helpers (mirror binance-copy-leaderboard) ─────────────────────

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toNum(v: unknown, fallback = 0): number {
  return toNumOrNull(v) ?? fallback
}

/** Binance reports percentages as raw values; normalize to 0-1 fractions. */
function pct(v: unknown): number | null {
  const n = toNumOrNull(v)
  return n === null ? null : n / 100
}

/** Base64 device fingerprint — screen, timezone, UA etc., as binance.com expects in `device-info`. */
function generateDeviceInfo(): string {
  const fingerprint = {
    screenResolution: '1920x1080',
    availableScreenResolution: '1920x1040',
    colorDepth: 24,
    pixelRatio: 1,
    timezone: 'Asia/Jakarta',
    timezoneOffset: -420,
    language: 'en-US',
    platform: 'Win32',
    userAgent: BINANCE_UA,
    hardwareConcurrency: 8,
    deviceMemory: 8,
  }
  return Buffer.from(JSON.stringify(fingerprint)).toString('base64')
}

/** Fresh per-request headers: random bnc-uuid + fresh device fingerprint each call. */
function buildBinanceHeaders(): Record<string, string> {
  return {
    accept: '*/*',
    'bnc-location': '',
    'bnc-time-zone': 'Asia/Jakarta',
    'bnc-uuid': randomUUID(),
    'content-type': 'application/json',
    cookie: '', // anonymous access works with an empty cookie
    origin: 'https://www.binance.com',
    referer: 'https://www.binance.com/en/copy-trading',
    'user-agent': BINANCE_UA,
    clienttype: 'web',
    csrftoken: '', // empty token is accepted
    'device-info': generateDeviceInfo(),
    lang: 'en',
    'sec-ch-ua': BINANCE_SEC_CH_UA,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  }
}

function pickTimeRange(v: unknown): string {
  const s = String(v ?? '30D').toUpperCase()
  return (TIME_RANGES as readonly string[]).includes(s) ? s : '30D'
}

// ── Normalizers ─────────────────────────────────────────────────────────────

function normalizeProfile(raw: BinanceDetailEnvelope): BinanceLeaderProfile | null {
  const d = raw?.data
  if (!d) return null
  const tags = Array.isArray(d.tagItemVos)
    ? d.tagItemVos.map((t) => t.tagName ?? '').filter(Boolean)
    : Array.isArray(d.tag)
      ? d.tag.filter(Boolean)
      : []
  const startTime = toNumOrNull(d.startTime)
  const tradeDays = startTime ? Math.max(1, Math.round((Date.now() - startTime) / 86_400_000)) : null
  return {
    id: String(d.leadPortfolioId ?? ''),
    nickName: d.nickname ?? '',
    nickNameTranslate: d.nicknameTranslate ?? null,
    avatar: d.avatarUrl ?? null,
    status: d.status ?? null,
    description: d.descTranslate ?? d.description ?? null,
    roi: null, // backfilled from the ROI chart's latest point after the equity section
    pnl: toNumOrNull(d.copierPnl),
    aum: toNumOrNull(d.aumAmount),
    marginBalance: toNumOrNull(d.marginBalance),
    maxDrawdown: null, // not exposed by lead-portfolio/detail
    sharpeRatio: toNumOrNull(d.sharpRatio),
    winRate: null, // not exposed by lead-portfolio/detail
    profitSharingRatio: pct(d.profitSharingRate),
    followerNum: toNumOrNull(d.currentCopyCount),
    maxCopyCount: toNumOrNull(d.maxCopyCount),
    totalCopyCount: toNumOrNull(d.totalCopyCount),
    mockCopyCount: toNumOrNull(d.mockCopyCount),
    asset: d.initInvestAsset ?? null,
    tradeDays,
    startTime,
    lastTradeTime: toNumOrNull(d.lastTradeTime),
    futuresType: d.futuresType ?? null,
    tags,
    badgeName: d.badgeName ?? null,
    aiSummary: d.aiSummary ?? null,
    favoriteCount: toNumOrNull(d.favoriteCount),
    futuresStatus: null, // set by the status section
    spotStatus: null, // set by the status section
  }
}

function normalizeChart(raw: BinanceChartEnvelope): BinanceChartPoint[] {
  return Array.isArray(raw?.data) ? raw.data : []
}

/** Merge ROI + PNL chart series by timestamp into one equity curve. */
function mergeEquity(roiPts: BinanceChartPoint[], pnlPts: BinanceChartPoint[]): BinanceEquityPoint[] {
  const byTime = new Map<number, BinanceEquityPoint>()
  for (const p of roiPts) {
    const t = toNum(p.dateTime)
    if (!t) continue
    byTime.set(t, { timestamp: t, roi: pct(p.value), pnl: null })
  }
  for (const p of pnlPts) {
    const t = toNum(p.dateTime)
    if (!t) continue
    const pt = byTime.get(t) ?? { timestamp: t, roi: null, pnl: null }
    pt.pnl = toNumOrNull(p.value)
    byTime.set(t, pt)
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function normalizeMarkets(raw: BinanceCoinEnvelope): BinanceMarketConcentration[] {
  const inner = raw?.data?.data
  if (!Array.isArray(inner)) return []
  return inner
    .map((m) => ({ symbol: String(m.asset ?? ''), volume: toNum(m.volume) }))
    .filter((m) => m.symbol.length > 0)
}

function normalizePositions(raw: BinancePositionsEnvelope): BinancePosition[] {
  const list = raw?.data
  if (!Array.isArray(list)) return []
  return list.map((p) => ({
    symbol: String(p.symbol ?? p.asset ?? ''),
    entryPrice: toNumOrNull(p.entryPrice),
    markPrice: toNumOrNull(p.markPrice),
    pnl: toNumOrNull(p.unrealizedProfit ?? p.pnl),
    roe: toNumOrNull(p.roe ?? p.pnlPercent),
    leverage: toNumOrNull(p.leverage),
    marginMode: p.marginType ?? p.marginMode ?? null,
  }))
}

// ── Transport ──────────────────────────────────────────────────────────────

/** GET + bapi envelope check. success===false fails; a missing success key is tolerated. */
async function binanceGet<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url, {
    headers: buildBinanceHeaders(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Binance ${label}: HTTP ${res.status}`)
  const body = (await res.json()) as BinanceEnvelope
  if (body?.code !== '000000' || body?.success === false) {
    throw new Error(`Binance ${label}: code ${body?.code ?? 'unknown'} (${body?.message ?? 'unknown'})`)
  }
  return body as T
}

// ── Module ─────────────────────────────────────────────────────────────────

const binancePerformanceModule: DataModule = {
  id: MODULE_ID,
  name: 'Binance Copy Leader Performance',
  category: 'derivatives',
  sourceType: 're',
  provenance: {
    describesItself:
      'Per-leader copy-trading performance intelligence from binance.com: profit curve, asset concentration, live positions, and trader profile.',
    upstreamProduct: 'Binance copy-trading leader detail dashboard',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-08-12',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await binanceGet<BinanceDetailEnvelope>(profileUrl(PROBE_PORTFOLIO_ID), 'lead-portfolio/detail')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (err) {
      return {
        status: 'degraded',
        lastChecked: new Date(),
        failureCount: 1,
        notes: err instanceof Error ? err.message : 'binance lead-portfolio/detail unreachable',
      }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const id = String(params.leaderId ?? params.portfolioId ?? params.id ?? '')
    if (!id) throw new Error('Binance performance: leaderId/portfolioId required')
    const timeRange = pickTimeRange(params.timeRange)

    const data: BinancePerformanceData = { profile: null, equity: [], markets: [], positions: [], trades: [] }
    let roiPoints: BinanceChartPoint[] = []
    let pnlPoints: BinanceChartPoint[] = []
    let anyCached = false

    // Each section fetches independently with its own cache key; one section
    // failing (e.g. WAF challenge mid-burst) leaves that section empty instead
    // of failing the whole aggregate.
    const sections: {
      name: string
      run: () => Promise<ModuleResult<unknown>>
      apply: (r: ModuleResult<unknown>) => void
    }[] = [
      {
        name: 'profile',
        run: () =>
          cachedFetch<BinanceDetailEnvelope>(MODULE_ID, { ...params, section: 'profile' }, BINANCE_TTL, () =>
            binanceGet<BinanceDetailEnvelope>(profileUrl(id), 'lead-portfolio/detail'),
          ),
        apply: (r) => {
          data.profile = normalizeProfile(r.data as BinanceDetailEnvelope)
        },
      },
      {
        name: 'equity-roi',
        run: () =>
          cachedFetch<BinanceChartEnvelope>(
            MODULE_ID,
            { ...params, section: 'equity', dataType: 'ROI' },
            BINANCE_TTL,
            () => binanceGet<BinanceChartEnvelope>(chartUrl(id, 'ROI', timeRange), 'chart-data ROI'),
          ),
        apply: (r) => {
          roiPoints = normalizeChart(r.data as BinanceChartEnvelope)
        },
      },
      {
        name: 'equity-pnl',
        run: () =>
          cachedFetch<BinanceChartEnvelope>(
            MODULE_ID,
            { ...params, section: 'equity', dataType: 'PNL' },
            BINANCE_TTL,
            () => binanceGet<BinanceChartEnvelope>(chartUrl(id, 'PNL', timeRange), 'chart-data PNL'),
          ),
        apply: (r) => {
          pnlPoints = normalizeChart(r.data as BinanceChartEnvelope)
        },
      },
      {
        name: 'markets',
        run: () =>
          cachedFetch<BinanceCoinEnvelope>(MODULE_ID, { ...params, section: 'markets' }, BINANCE_TTL, () =>
            binanceGet<BinanceCoinEnvelope>(marketsUrl(id, timeRange), 'performance/coin'),
          ),
        apply: (r) => {
          data.markets = normalizeMarkets(r.data as BinanceCoinEnvelope)
        },
      },
      {
        name: 'positions',
        run: () =>
          cachedFetch<BinancePositionsEnvelope>(MODULE_ID, { ...params, section: 'positions' }, BINANCE_TTL, () =>
            binanceGet<BinancePositionsEnvelope>(positionsUrl(id), 'lead-data/positions'),
          ),
        apply: (r) => {
          data.positions = normalizePositions(r.data as BinancePositionsEnvelope)
        },
      },
      {
        name: 'status',
        run: () =>
          cachedFetch<BinanceStatusEnvelope>(MODULE_ID, { ...params, section: 'status' }, BINANCE_TTL, () =>
            binanceGet<BinanceStatusEnvelope>(statusUrl(id), 'spot-futures-last-lead'),
          ),
        apply: (r) => {
          const s = (r.data as BinanceStatusEnvelope)?.data
          if (data.profile) {
            data.profile.futuresStatus = s?.futuresPublicLPStatus ?? null
            data.profile.spotStatus = s?.spotPublicLPStatus ?? null
          }
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

    data.equity = mergeEquity(roiPoints, pnlPoints)

    // The detail endpoint has no ROI field; backfill from the ROI curve's latest point.
    if (data.profile && data.equity.length > 0) {
      data.profile.roi = data.equity[data.equity.length - 1].roi
    }

    return {
      data: data as unknown as T,
      source: MODULE_ID,
      cached: anyCached,
      timestamp: Date.now(),
      ttl: BINANCE_TTL,
    }
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: { profile: null, equity: [], markets: [], positions: [], trades: [] } as unknown as T,
      source: 'binance-performance (fallback)',
      cached: true,
      timestamp: Date.now(),
      ttl: BINANCE_TTL,
    }
  },
}

export default binancePerformanceModule
