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
const MAX_PAGES = 3
const PAGE_LIMIT = 1000

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

export interface McSeriesOptions {
  timeframe?: McTimeframe
  /** Bars to request in total (default 300, capped at 3000). */
  barLimit?: number
  fetchFn?: typeof fetch
  nowMs?: number
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

/**
 * Fetch the MC series for one mint. Returns null when the token has no
 * usable base-token pool, no derivable supply, or no bars — the caller
 * must treat null as "no structure evidence", never as a flat curve.
 */
export async function fetchMcSeries(
  contract: string,
  opts: McSeriesOptions = {},
): Promise<McSeries | null> {
  const f = opts.fetchFn ?? fetch
  const timeframe = opts.timeframe ?? 'hour'
  const barLimit = Math.max(20, Math.min(opts.barLimit ?? 300, PAGE_LIMIT * MAX_PAGES))

  const poolsRes = await f(
    `${GECKO}/networks/solana/tokens/${encodeURIComponent(contract)}/pools?page=1`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!poolsRes.ok) return null
  const poolsJson = (await poolsRes.json()) as { data?: GtPool[] }
  if (!Array.isArray(poolsJson?.data)) return null

  const picked = pickPool(poolsJson.data, contract)
  if (!picked) return null
  const poolAddress = picked.pool.attributes?.address ?? picked.pool.id?.replace(/^solana_/, '')
  if (!poolAddress) return null

  const rows: number[][] = []
  let cursorSec: number | null = null
  const pages = Math.ceil(barLimit / PAGE_LIMIT)
  for (let i = 0; i < pages; i++) {
    const params = new URLSearchParams({ aggregate: '1', limit: String(PAGE_LIMIT) })
    if (cursorSec !== null) params.set('before_timestamp', String(cursorSec))
    const res = await f(
      `${GECKO}/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}?${params}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    if (!res.ok) break
    const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } }
    const list = json?.data?.attributes?.ohlcv_list
    if (!Array.isArray(list) || list.length === 0) break
    rows.push(...list)
    const oldest = list[list.length - 1]
    cursorSec = Array.isArray(oldest) && typeof oldest[0] === 'number' ? oldest[0] - 1 : null
    if (cursorSec === null || rows.length >= barLimit) break
  }
  if (rows.length === 0) return null

  const bars = parseOhlcv(rows.slice(0, barLimit), picked.supply)
  if (bars.length < 2) return null

  return {
    contract,
    supply: picked.supply,
    bars,
    timeframe,
    source: `geckoterminal:${timeframe}:pool-${poolAddress.slice(0, 8)}`,
  }
}
