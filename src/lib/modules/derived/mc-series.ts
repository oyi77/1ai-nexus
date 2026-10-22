// ─────────────────────────────────────────────────────────────
// MC series — market-cap history for a Solana mint, as the operator
// reads it on a chart. GeckoTerminal gives USD price OHLCV and the
// token's live market cap; supply = mcap / price is constant for a
// memecoin, so MC at any past bar = close × supply. No fabrication:
// when the pool, the supply, or the bars are missing, the caller gets
// null (never a synthesized curve).
//
// Verified live: Bonk mcap 257,180,537.62 / price 2.922694682e-6
// => supply 8.8e13, matching the real circulating supply — so an MC
// series derived this way is exact for supply-constant tokens.
//
// Keyless. Bounded: one pools call + at most MAX_PAGES OHLCV calls.
// ─────────────────────────────────────────────────────────────

const GECKO = 'https://api.geckoterminal.com/api/v2'
const TIMEOUT_MS = 10_000
const MAX_PAGES = 1
const PAGE_LIMIT = 1000
// Measured live 2026-10-22: keyless GeckoTerminal returns 429 even at one
// call every 30s (200/200/429/200), and the limit is shared with every other
// process on the host. A single-shot read is therefore a coin flip, so each
// request gets bounded retries and a full read costs ONE call (the pools
// response already carries 1000 hourly bars).
const RETRIES = 3
const RETRY_BASE_MS = 2_000
const MIN_GAP_MS = 2_500

export type McTimeframe = 'minute' | 'hour' | 'day'

export interface McBar {
  /** Bar open time, epoch ms. */
  timeMs: number
  openUsd: number
  highUsd: number
  lowUsd: number
  closeUsd: number
  /** USD notional traded in the bar (price × base volume). */
  volumeUsd: number
}

export interface McSeries {
  contract: string
  /** Tokens outstanding, derived from live mcap / live price. */
  supply: number
  /** Oldest → newest. */
  bars: McBar[]
  timeframe: McTimeframe
  source: string
}

/**
 * Why a series is missing, for the operator log: "no pool" is a real
 * verdict about the token, "throttled" is a verdict about the host. They
 * must never be reported as the same thing.
 */
export type McSeriesFailure = 'throttled' | 'no-pool' | 'no-bars'

export interface McSeriesOptions {
  timeframe?: McTimeframe
  /** Bars to request in total (default 300, capped at 3000). */
  barLimit?: number
  fetchFn?: typeof fetch
  nowMs?: number
  /** Injected in tests; defaults to a real timer. */
  sleepFn?: (ms: number) => Promise<void>
  /** Retries per request on 429/5xx (default RETRIES). */
  retries?: number
  /** Retry/backoff base in ms (default RETRY_BASE_MS). */
  retryBaseMs?: number
}

interface GtPoolAttributes {
  address?: string
  name?: string
  base_token_price_usd?: string
  market_cap_usd?: string | null
  fdv_usd?: string | null
  reserve_in_usd?: string | null
}

interface GtPool {
  id?: string
  attributes?: GtPoolAttributes
  relationships?: {
    base_token?: { data?: { id?: string } }
  }
}

function num(v: unknown): number | null {
  // The API mixes numeric and string fields; both parse through here.
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}

function mintOf(id: string | undefined): string {
  if (!id) return ''
  const i = id.indexOf('_')
  return i >= 0 ? id.slice(i + 1) : id
}

/**
 * Pick the pool whose BASE token is the mint itself and that carries the
 * most liquidity — a token quoted as the quote side of someone else's
 * pool must never be priced from that pool. Returns the derived supply
 * (market cap ÷ price) alongside, or null when nothing is usable.
 */
export function pickPool(pools: GtPool[], mint: string): { pool: GtPool; supply: number } | null {
  let best: { pool: GtPool; supply: number; reserve: number } | null = null
  for (const p of pools) {
    if (mintOf(p.relationships?.base_token?.data?.id) !== mint) continue
    const price = num(p.attributes?.base_token_price_usd)
    const mcap = num(p.attributes?.market_cap_usd) ?? num(p.attributes?.fdv_usd)
    if (price === null || price <= 0 || mcap === null || mcap <= 0) continue
    const supply = mcap / price
    if (!Number.isFinite(supply) || supply <= 0) continue
    const reserve = num(p.attributes?.reserve_in_usd) ?? 0
    if (!best || reserve > best.reserve) best = { pool: p, supply, reserve }
  }
  return best ? { pool: best.pool, supply: best.supply } : null
}

/**
 * Convert GeckoTerminal's newest-first `[tsSec, o, h, l, c, vol]` rows into
 * MC bars, oldest → newest. Rows with a non-positive close are dropped (a
 * dead bar is not a data point).
 */
export function parseOhlcv(rows: number[][], supply: number): McBar[] {
  const out: McBar[] = []
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 5) continue
    const [ts, o, h, l, c, v] = r
    if (![ts, o, h, l, c].every((x) => typeof x === 'number' && Number.isFinite(x))) continue
    if (!(c > 0)) continue
    out.push({
      timeMs: ts * 1000,
      openUsd: o * supply,
      highUsd: h * supply,
      lowUsd: l * supply,
      closeUsd: c * supply,
      volumeUsd: typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0,
    })
  }
  return out.sort((a, b) => a.timeMs - b.timeMs)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Host-wide spacing between GeckoTerminal calls, regardless of caller. */
let nextCallAt = 0

type GeckoResult<T> = { ok: true; json: T } | { ok: false; failure: McSeriesFailure }

interface GeckoCtx {
  fetchFn: typeof fetch
  sleepFn: (ms: number) => Promise<void>
  retries: number
  retryBaseMs: number
}

/**
 * One GeckoTerminal GET with the host-wide gap, bounded retries on 429/5xx,
 * and a classified failure. Never throws: an unreachable host is reported as
 * 'throttled' so the caller can say "the host was busy" instead of claiming
 * the token has no market.
 */
async function geckoJson<T>(url: string, ctx: GeckoCtx): Promise<GeckoResult<T>> {
  for (let attempt = 0; attempt <= ctx.retries; attempt++) {
    const wait = nextCallAt - Date.now()
    if (wait > 0) await ctx.sleepFn(wait)
    nextCallAt = Date.now() + MIN_GAP_MS
    let status = 0
    try {
      const res = await ctx.fetchFn(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      status = res.status
      if (res.ok) return { ok: true, json: (await res.json()) as T }
    } catch {
      status = 0
    }
    const retryable = status === 0 || status === 429 || status >= 500
    if (!retryable) return { ok: false, failure: 'no-pool' }
    if (attempt < ctx.retries) {
      const backoff = ctx.retryBaseMs * 2 ** attempt
      await ctx.sleepFn(backoff + Math.floor(Math.random() * 250))
    }
  }
  return { ok: false, failure: 'throttled' }
}

/**
 * Fetch the MC series for one mint. Returns null when the token has no
 * usable base-token pool, no derivable supply, or no bars — the caller
 * must treat null as "no structure evidence", never as a flat curve.
 *
 * A throttled host is NOT a token without a market: `onFailure` reports
 * which one happened. Both still yield null, because an unread series can
 * never prove a strategy.
 */
export async function fetchMcSeries(
  contract: string,
  opts: McSeriesOptions = {},
  onFailure?: (reason: McSeriesFailure) => void,
): Promise<McSeries | null> {
  const ctx: GeckoCtx = {
    fetchFn: opts.fetchFn ?? fetch,
    sleepFn: opts.sleepFn ?? sleep,
    retries: opts.retries ?? RETRIES,
    retryBaseMs: opts.retryBaseMs ?? RETRY_BASE_MS,
  }
  const timeframe = opts.timeframe ?? 'hour'
  const barLimit = Math.max(20, Math.min(opts.barLimit ?? 300, PAGE_LIMIT * MAX_PAGES))

  const pools = await geckoJson<{ data?: GtPool[] }>(
    `${GECKO}/networks/solana/tokens/${encodeURIComponent(contract)}/pools?page=1`,
    ctx,
  )
  if (!pools.ok) {
    onFailure?.(pools.failure)
    return null
  }
  if (!Array.isArray(pools.json?.data)) {
    onFailure?.('no-pool')
    return null
  }

  const picked = pickPool(pools.json.data, contract)
  if (!picked) {
    onFailure?.('no-pool')
    return null
  }
  const poolAddress = picked.pool.attributes?.address ?? picked.pool.id?.replace(/^solana_/, '')
  if (!poolAddress) {
    onFailure?.('no-pool')
    return null
  }

  const rows: number[][] = []
  let cursorSec: number | null = null
  const pages = Math.ceil(barLimit / PAGE_LIMIT)
  for (let i = 0; i < pages; i++) {
    const params = new URLSearchParams({ aggregate: '1', limit: String(PAGE_LIMIT) })
    if (cursorSec !== null) params.set('before_timestamp', String(cursorSec))
    const page = await geckoJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
      `${GECKO}/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}?${params}`,
      ctx,
    )
    if (!page.ok) {
      if (rows.length === 0) {
        onFailure?.(page.failure)
        return null
      }
      break
    }
    const list = page.json?.data?.attributes?.ohlcv_list
    if (!Array.isArray(list) || list.length === 0) break
    rows.push(...list)
    const oldest = list[list.length - 1]
    cursorSec = Array.isArray(oldest) && typeof oldest[0] === 'number' ? oldest[0] - 1 : null
    if (cursorSec === null || rows.length >= barLimit) break
  }
  if (rows.length === 0) {
    onFailure?.('no-bars')
    return null
  }

  const bars = parseOhlcv(rows.slice(0, barLimit), picked.supply)
  if (bars.length < 2) {
    onFailure?.('no-bars')
    return null
  }

  return {
    contract,
    supply: picked.supply,
    bars,
    timeframe,
    source: `geckoterminal:${timeframe}:pool-${poolAddress.slice(0, 8)}`,
  }
}
