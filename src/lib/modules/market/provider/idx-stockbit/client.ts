// ─────────────────────────────────────────────────────────────
// Stockbit API client — thin authed fetch wrapper over exodus.
// All param contracts verified live 2026-09-16 (see
// local/stockbit-auth-re.md §3–13). SERVER-ONLY.
//
// Conventions (grpc-gateway is casing-inconsistent — follow per
// family, do NOT "normalize"):
// - marketdetectors: UPPER_SNAKE enums
// - order-queue: snake `stock_code` (NOT symbol)
// - broker/activity: snake `broker_code` + `symbol`
// - broker-directory / hotlist: lowercase `limit`, `page`
// Bearer comes from resolveStockbitAccessToken (auto-rotate).
// ─────────────────────────────────────────────────────────────

import { resolveStockbitAccessToken, redactJwt, hasSessionCredentials } from './session'

const EXODUS = 'https://exodus.stockbit.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

export function stockbitAvailable(): boolean {
  return hasSessionCredentials()
}

/** Normalize user input: 'BBCA.JK'/'bbri' → 'BBRI'. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\.JK$/, '')
}

export async function sbGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await resolveStockbitAccessToken()
  const url = EXODUS + path + (params ? `?${new URLSearchParams(params).toString()}` : '')
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      origin: 'https://stockbit.com',
      referer: 'https://stockbit.com/',
      'user-agent': UA,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Stockbit ${path} HTTP ${res.status}: ${redactJwt(text).slice(0, 200)}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Stockbit ${path}: non-JSON response`)
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

// ── Broker summary (/marketdetectors/{SYM}) ────────────────────

export interface BandarBrokerRow {
  code: string
  lot: number | null
  value: number | null
  avgPrice: number | null
  freq: number | null
  foreign: boolean
}

export interface BandarLevel {
  accdist: string
  amount: number | null
  pct: number | null
}

export interface BandarSummary {
  code: string
  tradeDate: string
  buyCount: number
  sellCount: number
  buy: BandarBrokerRow[]
  sell: BandarBrokerRow[]
  accdist: string
  levels: Record<string, BandarLevel> // avg | avg5 | top1 | top3 | top5 | top10
}

function toBrokerRow(r: Record<string, unknown>): BandarBrokerRow {
  return {
    code: typeof r.netbs_broker_code === 'string' ? r.netbs_broker_code : '',
    lot: num(r.blot),
    value: num(r.bval),
    avgPrice: num(r.netbs_buy_avg_price),
    freq: num(r.freq),
    foreign: r.type === 'Asing',
  }
}

function toLevel(v: unknown): BandarLevel {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  return {
    accdist: typeof o.accdist === 'string' ? o.accdist : '',
    amount: num(o.amount),
    pct: num(o.percent),
  }
}

/** Pure parser — unit-testable, no network. Null on error envelope. */
export function parseBandarSummary(code: string, payload: unknown): BandarSummary | null {
  if (typeof payload !== 'object' || payload === null) return null
  const d = (payload as Record<string, unknown>).data
  if (typeof d !== 'object' || d === null) return null
  const o = d as Record<string, unknown>
  const bs = (typeof o.broker_summary === 'object' && o.broker_summary !== null
    ? o.broker_summary
    : {}) as Record<string, unknown>
  const bd = (typeof o.bandar_detector === 'object' && o.bandar_detector !== null
    ? o.bandar_detector
    : {}) as Record<string, unknown>
  const buy = Array.isArray(bs.brokers_buy) ? bs.brokers_buy : []
  const sell = Array.isArray(bs.brokers_sell) ? bs.brokers_sell : []
  const levels: Record<string, BandarLevel> = {}
  for (const k of ['avg', 'avg5', 'top1', 'top3', 'top5', 'top10']) {
    levels[k] = toLevel(bd[k])
  }
  const from = typeof o.from === 'string' ? o.from.slice(0, 10) : ''
  return {
    code,
    tradeDate: from,
    buyCount: buy.length,
    sellCount: sell.length,
    buy: (buy as Record<string, unknown>[]).map(toBrokerRow),
    sell: (sell as Record<string, unknown>[]).map(toBrokerRow),
    accdist:
      typeof bd.broker_accdist === 'string' ? (bd.broker_accdist as string) : '',
    levels,
  }
}

export async function fetchBandarSummary(code: string): Promise<BandarSummary | null> {
  const payload = await sbGet<unknown>(`/marketdetectors/${code}`, {
    transaction_type: 'TRANSACTION_TYPE_NET',
    market_board: 'MARKET_BOARD_REGULER',
    investor_type: 'INVESTOR_TYPE_ALL',
    limit: '50',
    period: 'BROKER_SUMMARY_PERIOD_LATEST',
  })
  return parseBandarSummary(code, payload)
}

// ── Distribution matrix (/order-trade/broker/distribution) ─────

export interface Counterparty {
  code: string
  amount: number | null
}

export interface MatrixSide {
  code: string
  amount: number | null
  counterparties: Counterparty[]
}

export interface DistributionMatrix {
  code: string
  session: string
  topBuyer: MatrixSide | null
  topSeller: MatrixSide | null
}

function toSide(v: unknown): MatrixSide | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const detail = (typeof o.detail === 'object' && o.detail !== null ? o.detail : {}) as Record<string, unknown>
  const dist = Array.isArray(o.distribute_to) ? o.distribute_to : []
  return {
    code: typeof detail.code === 'string' ? detail.code : '',
    amount: num(detail.amount),
    counterparties: (dist as Record<string, unknown>[]).map(c => ({
      code: typeof c.code === 'string' ? c.code : '',
      amount: num(c.amount),
    })),
  }
}

/** Pure parser — unit-testable. Null on error envelope. */
export function parseDistribution(code: string, payload: unknown): DistributionMatrix | null {
  if (typeof payload !== 'object' || payload === null) return null
  const d = (payload as Record<string, unknown>).data
  if (typeof d !== 'object' || d === null) return null
  const o = d as Record<string, unknown>
  const bv = (typeof o.by_value === 'object' && o.by_value !== null ? o.by_value : {}) as Record<string, unknown>
  const tb = Array.isArray(bv.top_broker_buy) ? bv.top_broker_buy : []
  const ts = Array.isArray(bv.top_broker_sell) ? bv.top_broker_sell : []
  return {
    code,
    session: typeof o.start_date === 'string' ? o.start_date.slice(0, 10) : '',
    topBuyer: tb.length > 0 ? toSide(tb[0]) : null,
    topSeller: ts.length > 0 ? toSide(ts[0]) : null,
  }
}

export async function fetchDistribution(code: string): Promise<DistributionMatrix | null> {
  const payload = await sbGet<unknown>('/order-trade/broker/distribution', {
    symbol: code,
    data_type: 'BROKER_DISTRIBUTION_DATA_TYPE_VALUE',
    investor_type: 'INVESTOR_TYPE_ALL',
    market_board: 'MARKET_TYPE_REGULER',
    period: 'TB_PERIOD_PREVIOUS_DAY',
  })
  return parseDistribution(code, payload)
}

// ── Order queue (/order-trade/order-queue?stock_code=) ─────────

export interface QueueStats {
  code: string
  open: boolean
  orders: number
  bidLots: number
  offerLots: number
}

export async function fetchQueueStats(code: string): Promise<QueueStats> {
  const payload = await sbGet<{ data?: { is_open_market?: boolean; orders?: Array<Record<string, unknown>> } }>(
    '/order-trade/order-queue',
    { stock_code: code },
  )
  const orders = payload.data?.orders ?? []
  let bid = 0
  let offer = 0
  for (const o of orders) {
    const lot = num(o.lot) ?? 0
    if (o.action_type === 'ACTION_TYPE_BUY') bid += lot
    else if (o.action_type === 'ACTION_TYPE_SELL') offer += lot
  }
  return { code, open: payload.data?.is_open_market ?? false, orders: orders.length, bidLots: bid, offerLots: offer }
}

// ── Guru presets (/screener/templates/{id}?type=TEMPLATE_TYPE_GURU)

export interface GuruMatch {
  symbol: string
  name: string
  results: Array<{ id: number; item: string; display: string; raw: string }>
}

export async function fetchGuruRun(templateId: number): Promise<{ name: string; matches: GuruMatch[] }> {
  const payload = await sbGet<{
    data?: {
      screen_name?: string
      calcs?: Array<{ company?: { symbol?: string; name?: string }; results?: GuruMatch['results'] }>
    }
  }>(`/screener/templates/${templateId}`, { type: 'TEMPLATE_TYPE_GURU' })
  const calcs = payload.data?.calcs ?? []
  return {
    name: payload.data?.screen_name ?? `guru-${templateId}`,
    matches: calcs.map(c => ({
      symbol: c.company?.symbol ?? '',
      name: c.company?.name ?? '',
      results: c.results ?? [],
    })),
  }
}

// ── Analyst (/analyst-ratings/{SYM} + /consensus) ───────────────

export interface StockbitAnalyst {
  code: string
  recommendation: string
  buy: number
  sell: number
  hold: number
  total: number
  target: number | null
  low: number | null
  high: number | null
  updatedAt: string
}

export async function fetchAnalyst(code: string): Promise<StockbitAnalyst | null> {
  const payload = await sbGet<{
    data?: {
      recommendation?: string
      total_buy?: number
      total_sell?: number
      total_hold?: number
      total_analyst?: number
      price_target?: { best_target?: number; best_low_target?: number; best_high_target?: number }
      last_updated?: string
    }
  }>(`/analyst-ratings/${code}`)
  const d = payload.data
  if (!d) return null
  return {
    code,
    recommendation: d.recommendation ?? '',
    buy: d.total_buy ?? 0,
    sell: d.total_sell ?? 0,
    hold: d.total_hold ?? 0,
    total: d.total_analyst ?? 0,
    target: num(d.price_target?.best_target),
    low: num(d.price_target?.best_low_target),
    high: num(d.price_target?.best_high_target),
    updatedAt: d.last_updated ?? '',
  }
}

// ── Stream (/stream/v3/symbol/{SYM}) ────────────────────────────

export interface StreamPost {
  id: number
  content: string
  createdAt: string
  username: string
}

export async function fetchStreamPosts(
  code: string,
  limit = 20,
): Promise<{ posts: StreamPost[]; cursor: string | null }> {
  const payload = await sbGet<{
    data?: {
      stream?: Array<{
        stream_id?: number
        content_original?: string
        content?: string
        created_at?: string
        user?: { username?: string }
      }>
      pagination?: { next_cursor?: string; is_last_page?: boolean }
    }
  }>(`/stream/v3/symbol/${code}`)
  const rows = payload.data?.stream ?? []
  return {
    posts: rows.slice(0, limit).map(r => ({
      id: r.stream_id ?? 0,
      content: r.content_original ?? r.content ?? '',
      createdAt: r.created_at ?? '',
      username: r.user?.username ?? '',
    })),
    cursor: payload.data?.pagination?.next_cursor ?? null,
  }
}

// ── Corp actions today (/corpaction) ────────────────────────────

export interface CorpToday {
  symbol: string
  kind: 'dividend' | 'other'
  exdate: string
  value: string
}

export async function fetchCorpToday(): Promise<CorpToday[]> {
  const payload = await sbGet<{
    data?: { dividend?: Array<Record<string, unknown>>; bonus?: Array<Record<string, unknown>> }
  }>('/corpaction')
  const out: CorpToday[] = []
  for (const r of payload.data?.dividend ?? []) {
    out.push({
      symbol: typeof r.company_symbol === 'string' ? r.company_symbol : '',
      kind: 'dividend',
      exdate: typeof r.dividend_exdate === 'string' ? r.dividend_exdate : '',
      value: typeof r.dividend_value === 'string' ? r.dividend_value : String(r.dividend_value ?? ''),
    })
  }
  for (const r of payload.data?.bonus ?? []) {
    out.push({
      symbol: typeof r.company_symbol === 'string' ? r.company_symbol : '',
      kind: 'other',
      exdate: '',
      value: '',
    })
  }
  return out
}
