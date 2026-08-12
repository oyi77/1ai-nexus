// ─────────────────────────────────────────────────────────────
// Module: Binance Copy-Trading Leaderboard
// sourceType: re
// upstreamProduct: Binance Futures copy-trading leaderboard web dashboard
// endpoint: https://www.binance.com/bapi/futures/v1/friendly/future/copy-trade/home-page/recommend-lead-list
// discoveredVia: devtools-network-tab
// lastVerified: 2026-08-11
// UNOFFICIAL: this calls binance.com's internal frontend API, not their public API.
//   It may break without notice if they change their dashboard.
//   fallbackFn: hyperliquid-copy-leaderboard
// Anonymous access works (empty cookie + fresh bnc-uuid/device-info per request);
// a fresh device fingerprint avoids triggering the AWS WAF challenge.
// ─────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto'
import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'
import hyperliquidCopyModule from '../hyperliquid-copy/leaderboard'
import type { CopyTradingLeader, CopyTradingPlatform } from '../copy-trading/types'

const BINANCE_LEADERBOARD_URL =
  'https://www.binance.com/bapi/futures/v1/friendly/future/copy-trade/home-page/recommend-lead-list'

const BINANCE_TTL = 180_000 // 3 min — mirrors gateio-copy-leaderboard (TOKEN_DATA × RE_MULTIPLIER)

const BINANCE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

// Real Chrome brand string — never the HeadlessChrome token that trips Binance's AWS WAF.
const BINANCE_SEC_CH_UA = '"Google Chrome";v="127", "Chromium";v="127", "Not)A;Brand";v="24"'

interface BinanceLeaderRow {
  leadPortfolioId?: string
  nickname?: string
  avatarUrl?: string | null
  currentCopyCount?: number
  maxCopyCount?: number
  roi?: number
  pnl?: number
  aum?: number
  mdd?: number
  winRate?: number
  sharpRatio?: number | null
  tradFiTag?: string | null
}

interface BinanceLeaderEnvelope {
  code?: string
  message?: string | null
  data?: {
    highestPnlLeads?: BinanceLeaderRow[]
  }
  success?: boolean
}

function toNum(v: number | string | null | undefined): number {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
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

function normalizeBinanceRows(rows: BinanceLeaderRow[]): CopyTradingLeader[] {
  return rows.map(r => ({
    id: String(r.leadPortfolioId),
    platform: 'binance' as CopyTradingPlatform,
    nick: r.nickname ?? `Trader ${r.leadPortfolioId}`,
    avatar: r.avatarUrl ?? null,
    level: 0, // not provided by this endpoint
    labels: r.tradFiTag ? [r.tradFiTag] : [],
    profit: toNum(r.pnl),
    // Binance returns percentages (95.79, 144.75); CopyTradingLeader expects 0-1 fractions.
    profitRate: toNum(r.roi) / 100,
    winRate: toNum(r.winRate) / 100,
    maxDrawdown: toNum(r.mdd),
    sharpe: toNum(r.sharpRatio),
    aum: toNum(r.aum),
    followers: r.currentCopyCount ?? 0,
    maxFollowers: r.maxCopyCount ?? 0,
    leadingDays: 0, // not provided by this endpoint
    plRatio: 0, // not provided by this endpoint
    isPrivate: false,
    createTime: null, // not provided by this endpoint
  }))
}

/** Fetch the Binance futures copy-trading recommend-lead list (highest-PnL leaders). */
async function fetchBinanceList(pageSize: number, portfolioType = 'PUBLIC_SIGNAL'): Promise<{ leaders: CopyTradingLeader[]; total: number }> {
  const res = await fetch(BINANCE_LEADERBOARD_URL, {
    method: 'POST',
    headers: buildBinanceHeaders(),
    body: JSON.stringify({ portfolioType }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Binance recommend-lead-list: HTTP ${res.status}`)
  const body = (await res.json()) as BinanceLeaderEnvelope
  if (body?.code !== '000000' || body?.success !== true) {
    throw new Error(`Binance recommend-lead-list: code ${body?.code ?? 'unknown'} (${body?.message ?? 'unknown'})`)
  }
  const rows = body.data?.highestPnlLeads ?? []
  // No upstream pagination — the endpoint returns the full list; slice client-side.
  const sliced = rows.slice(0, Math.max(1, pageSize))
  return { leaders: normalizeBinanceRows(sliced), total: rows.length }
}

async function fetchBinanceLeaderboard(params: FetchParams): Promise<{ leaders: CopyTradingLeader[]; total: number }> {
  const pageSize = Number(params.page_size ?? 50)
  const portfolioType = String(params.portfolioType ?? 'PUBLIC_SIGNAL')
  return fetchBinanceList(pageSize, portfolioType)
}

async function probeBinance(): Promise<boolean> {
  try {
    const { leaders } = await fetchBinanceList(1)
    return leaders.length > 0
  } catch {
    return false
  }
}

const binanceCopyLeaderboardModule: DataModule = {
  id: 'binance-copy-leaderboard',
  name: 'Binance Copy-Trading Leaderboard',
  category: 'market',
  sourceType: 're',
  provenance: {
    describesItself: 'Binance futures copy-trading leaderboard via www.binance.com web API (anonymous)',
    upstreamProduct: 'Binance copy-trading leaderboard dashboard',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-08-11',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    const ok = await probeBinance()
    const now = new Date()
    return ok
      ? { status: 'active', lastChecked: now, lastSuccess: now, failureCount: 0 }
      : { status: 'offline', lastChecked: now, failureCount: 1, notes: 'binance recommend-lead-list unreachable' }
  },

  async fallbackFn<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return hyperliquidCopyModule.fetch<T>(params)
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'binance-copy-leaderboard',
      { ...params, platform: params.platform ?? 'binance' },
      BINANCE_TTL,
      () => fetchBinanceLeaderboard(params) as Promise<T>,
    )
  },
}

export default binanceCopyLeaderboardModule
