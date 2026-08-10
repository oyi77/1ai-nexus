// ─────────────────────────────────────────────────────────────
// Module: Gate.io Copy-Trading Leaderboard
// sourceType: re
// upstreamProduct: Gate.io copy-trading leaderboard web dashboard
// endpoint: https://www.gate.tv/apiw/v2/copy/leader/list
// discoveredVia: devtools-network-tab
// lastVerified: 2026-08-11
// UNOFFICIAL: this calls gate.tv's internal frontend API, not their public API.
//   It may break without notice if they change their dashboard.
//   fallbackFn: hyperliquid-copy-leaderboard
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'
import hyperliquidCopyModule from '../hyperliquid-copy/leaderboard'
import type { CopyTradingLeader, CopyTradingPlatform } from '../copy-trading/types'

/** www.gate.io/www.gate.com are Akamai-blocked from datacenter IPs; www.gate.tv serves the same API anonymously. */
const GATEIO_HOSTS = [
  'https://www.gate.tv',
  'https://www.gate.com',
  'https://www.gate.io',
] as const

const GATEIO_TTL = TTL.TOKEN_DATA * TTL.RE_MULTIPLIER // 60s × 3 = 180s

const GATEIO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.gate.tv/copytrading',
  'x-sub-website-id': '0',
  'sub_website_id': '0',
} as const

interface GateLabelText {
  label_name?: string
}

interface GateLabelInfo {
  text?: GateLabelText[]
}

interface GateLeaderRow {
  leader_id: number
  level: number
  profit?: string | number
  profit_rate?: string | number
  win_rate?: string | number
  max_drawdown?: string | number
  follow_profit?: string | number
  curr_follow_num?: number
  max_follow_num?: number
  total_follow_num?: number
  aum?: string | number
  sharp_ratio?: string | number
  leading_days?: number
  pl_ratio?: string | number
  is_private_leader?: boolean
  create_time?: number
  user_info?: { nick?: string; avatar?: string }
  label_info?: GateLabelInfo
}

interface GateLeaderEnvelope {
  code: number
  message?: string
  data?: {
    list?: GateLeaderRow[]
    totalcount?: number
  }
}

function toNum(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Sort keys gate.tv actually accepts upstream. Client-only keys (win_rate, level)
 * are rejected with code -1 "Service is busy" — map them to a supported key here;
 * the route client-sorts by the requested key afterwards.
 */
const GATEIO_SORTABLE: Record<string, true> = {
  profit: true,
  profit_rate: true,
  aum: true,
  max_drawdown: true,
  follow_num: true,
}

function upstreamOrderBy(orderBy: string): string {
  return GATEIO_SORTABLE[orderBy] ? orderBy : 'aum'
}

/** Fetch the gate.io copy-trading leader list from the first reachable host (200 + code 0 wins). */
async function fetchGateioList(pageSize: number, cycle: string, orderBy: string): Promise<{ rows: GateLeaderRow[]; total: number }> {
  // Upstream rejects page_size > 100 with the misleading "Service is busy" code -1;
  // clamp so large page_size (route allows up to 200) degrades to 100 rows instead of erroring.
  const clamped = Math.max(1, Math.min(pageSize, 100))
  const qs = `cycle=${cycle}&page=1&page_size=${clamped}&status=running&order_by=${upstreamOrderBy(orderBy)}&sub_website_id=0`
  let lastErr: unknown = new Error('no host attempted')

  for (const host of GATEIO_HOSTS) {
    try {
      const res = await fetch(`${host}/apiw/v2/copy/leader/list?${qs}`, {
        headers: GATEIO_HEADERS,
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`)
      const body = (await res.json()) as GateLeaderEnvelope
      if (body?.code !== 0) throw new Error(`${host}: code ${body?.code} (${body?.message ?? 'unknown'})`)
      return { rows: body.data?.list ?? [], total: body.data?.totalcount ?? (body.data?.list?.length ?? 0) }
    } catch (e) {
      lastErr = e
      // try next host
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function normalizeGateioRows(rows: GateLeaderRow[]): CopyTradingLeader[] {
  return rows.map(r => ({
    id: String(r.leader_id),
    platform: 'gateio' as CopyTradingPlatform,
    nick: r.user_info?.nick ?? `Trader ${r.leader_id}`,
    avatar: r.user_info?.avatar ?? null,
    level: r.level ?? 0,
    labels: (r.label_info?.text ?? []).map(t => t.label_name ?? '').filter(Boolean),
    profit: toNum(r.profit),
    profitRate: toNum(r.profit_rate),
    winRate: toNum(r.win_rate),
    maxDrawdown: toNum(r.max_drawdown),
    sharpe: toNum(r.sharp_ratio),
    aum: toNum(r.aum),
    followers: r.curr_follow_num ?? r.total_follow_num ?? 0,
    maxFollowers: r.max_follow_num ?? 0,
    leadingDays: r.leading_days ?? 0,
    plRatio: toNum(r.pl_ratio),
    isPrivate: r.is_private_leader ?? false,
    createTime: r.create_time ?? null,
  }))
}

async function fetchGateioLeaderboard(params: FetchParams): Promise<{ leaders: CopyTradingLeader[]; total: number }> {
  const pageSize = Number(params.page_size ?? 50)
  const cycle = String(params.cycle ?? 'month')
  const orderBy = String(params.order_by ?? 'aum')
  const { rows, total } = await fetchGateioList(pageSize, cycle, orderBy)
  return { leaders: normalizeGateioRows(rows), total }
}

async function probeGateio(): Promise<boolean> {
  try {
    const { rows } = await fetchGateioList(1, 'month', 'aum')
    return rows.length > 0
  } catch {
    return false
  }
}

const gateioCopyLeaderboardModule: DataModule = {
  id: 'gateio-copy-leaderboard',
  name: 'Gate.io Copy-Trading Leaderboard',
  category: 'market',
  sourceType: 're',
  provenance: {
    describesItself: 'Gate.io copy-trading leaderboard via www.gate.tv web API (anonymous)',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-08-11',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    const ok = await probeGateio()
    const now = new Date()
    return ok
      ? { status: 'active', lastChecked: now, lastSuccess: now, failureCount: 0 }
      : { status: 'offline', lastChecked: now, failureCount: 1, notes: 'gate.tv leader list unreachable' }
  },

  async fallbackFn<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return hyperliquidCopyModule.fetch<T>(params)
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'gateio-copy-leaderboard',
      { ...params, platform: params.platform ?? 'gateio' },
      GATEIO_TTL,
      () => fetchGateioLeaderboard(params) as Promise<T>,
    )
  },
}

export default gateioCopyLeaderboardModule