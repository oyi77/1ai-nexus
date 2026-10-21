// ─────────────────────────────────────────────────────────────
// Historical Solana token USD price oracle — keyless, read-only.
//
// WHY THIS EXISTS
// The harvest pipeline (`solana-harvest.ts`) can only prove CURRENT price
// via Jupiter lite-api. `fillCurrentUsd` therefore tags every leg
// `stalePrice-current-only` and `classifyBuy`/`swapToTransactionRow` reject
// them → 0 eligible swaps → 0 Transaction rows → classifier dead.
//
// WHAT WORKS (proven live, 2026-10-14)
// GeckoTerminal public API (api.geckoterminal.com, NO key):
//   1. GET /api/v2/networks/solana/tokens/{mint}/pools
//      → token→pool resolution incl. base/quote token IDs per pool.
//   2. GET /api/v2/networks/solana/pools/{pool}/ohlcv/{minute|hour|day}
//      ?before_timestamp={s}&limit={n}
//      → [[timestamp_s, open, high, low, close, volume], …]
//      `close` is USD-denominated by default (currency=usd is the default),
//      even for SOL-quoted pools — verified live: WETH/SOL pool close
//      2506 ≈ base_token_price_usd 2501, NOT the ~23.5 SOL quote price.
//      Older than 180 days → HTTP 401 (paid plan) — documented, not faked.
//
// WHAT DOES NOT WORK (all verified with real HTTP codes, 2026-10-14)
//   • public-api.birdeye.so/defi/price + /defi/history_price → 401 keyless.
//   • api.geckoterminal.com token-level OHLCV (/tokens/{mint}/ohlcv/…) → 401.
//   • quote-api.jup.ag/v6/quote → current-only quote; no historical route.
//   • api.coingecko.com simple price → majors only; not per-mint.
//   • api.dexscreener.com → pairCreatedAt + CURRENT priceUsd only; no history.
//
// HONESTY: GeckoTerminal OHLCV history starts when the pool was first
// tracked. A bar at the exact trade second may not exist (intervals with
// no swaps are skipped, and newly created pump pools lag ~1 minute). The
// caller gets {usd:null, source:'error', note} in that case — never a
// fabricated number.
// ─────────────────────────────────────────────────────────────

export const GECKO_API = 'https://api.geckoterminal.com/api/v2';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_DELAY_MS = 250;

export type OhlcvTimeframe = 'minute' | 'hour' | 'day';

export interface OhlcvBar {
  time: number; // epoch SECONDS (GeckoTerminal convention)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GtPoolRef {
  address: string;
  baseTokenId: string; // "solana_<mint>"
  quoteTokenId: string; // "solana_<mint>"
  baseMint: string;
  quoteMint: string;
  reserveUsd: number | null;
}

export interface HistoricalPriceOptions {
  /** Bar interval. Defaults by token age: minute <3d, hour <180d, day. */
  timeframe?: OhlcvTimeframe;
  /** Seconds to look back from atMs for a containing bar. Default 90. */
  lookbackSeconds?: number;
  /** Override fetch (tests). */
  fetchFn?: FetchFn;
  /** Per-call timeout. Default 8s. */
  timeoutMs?: number;
}

export interface HistoricalPriceResult {
  usd: number | null;
  /** Which path produced the number. 'error' means usd is null. */
  source: string;
  atMs: number;
  note?: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// ─── module state (cache + rate limit) ───────────────────────

/** token mint → preferred pool ref. Keyless resolution is the slow path. */
const poolCache = new Map<string, GtPoolRef | null>();
/** monotonic last-call time for the global GeckoTerminal rate limiter. */
let lastGtCallMs = 0;
let fetchOverride: FetchFn | null = null;

export function __setHistoricalPriceFetchForTests(fn: FetchFn | null): void {
  fetchOverride = fn;
}

export function __resetHistoricalPriceCacheForTests(): void {
  poolCache.clear();
  lastGtCallMs = 0;
}

function http(): FetchFn {
  if (fetchOverride) return fetchOverride;
  return (url, init) => fetch(url, init);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Enforce >=250ms between GeckoTerminal calls, across all callers. */
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, MIN_DELAY_MS - (now - lastGtCallMs));
  lastGtCallMs = now + wait;
  if (wait > 0) await sleep(wait);
}

async function gtGetJson(
  path: string,
  opts: { timeoutMs: number; fetchFn: FetchFn },
): Promise<unknown> {
  await rateLimit();
  const headers = { Accept: 'application/json', 'User-Agent': 'nexus/1.0' };

  /** One request with its own controller: an aborted signal can never be
   *  reused, so each attempt (including the 429 retry) needs a fresh one. */
  const call = async (): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      return await opts.fetchFn(`${GECKO_API}${path}`, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const res = await call();
  if (res.status === 429) {
    // Public tier is ~30 calls/minute. Back off and retry once politely.
    const body = await res.text().catch(() => '');
    await sleep(1_500);
    await rateLimit();
    const retry = await call().catch(() => null);
    if (!retry) return { __httpStatus: 429, __body: body };
    if (!retry.ok) return { __httpStatus: retry.status, __body: await retry.text().catch(() => '') };
    return (await retry.json().catch(() => null)) as unknown;
  }
  if (!res.ok) {
    return { __httpStatus: res.status, __body: await res.text().catch(() => '') };
  }
  return (await res.json().catch(() => null)) as unknown;
}

// ─── pure helpers ────────────────────────────────────────────

/**
 * Pick the OHLCV bar that should price a trade at `atMs`.
 *
 * Contract: bars are `{time: epoch SECONDS, …}` sorted OLDEST→NEWEST.
 * Return the bar whose `[time, time+intervalSeconds)` contains `atMs`;
 * if none contains it, the latest bar with `time <= atMs` (so a trade in a
 * skipped/empty interval prices at the last known close); otherwise null.
 */
export function pickBarForTimestamp(
  bars: readonly OhlcvBar[],
  atMs: number,
  intervalSeconds = 60,
): OhlcvBar | null {
  if (!Number.isFinite(atMs) || atMs <= 0) return null;
  if (bars.length === 0) return null;
  const atSec = Math.floor(atMs / 1000);
  let lastBefore: OhlcvBar | null = null;
  for (const bar of bars) {
    if (!Number.isFinite(bar.time)) continue;
    if (bar.time <= atSec && bar.time + intervalSeconds > atSec) return bar;
    if (bar.time <= atSec) lastBefore = bar;
  }
  return lastBefore;
}

// ─── GeckoTerminal parsing ───────────────────────────────────

interface GtPoolRaw {
  id?: string;
  attributes?: {
    address?: string;
    reserve_in_usd?: string | null;
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
}

function parsePoolRaw(raw: unknown): GtPoolRef | null {
  const p = raw as GtPoolRaw;
  const address = p?.attributes?.address ?? p?.id?.replace(/^solana_/, '') ?? '';
  const baseTokenId = p?.relationships?.base_token?.data?.id ?? '';
  const quoteTokenId = p?.relationships?.quote_token?.data?.id ?? '';
  const idx = baseTokenId.indexOf('_');
  const baseMint = idx >= 0 ? baseTokenId.slice(idx + 1) : baseTokenId;
  const qidx = quoteTokenId.indexOf('_');
  const quoteMint = qidx >= 0 ? quoteTokenId.slice(qidx + 1) : quoteTokenId;
  if (!address || !baseMint || !quoteMint) return null;
  const reserveRaw = p?.attributes?.reserve_in_usd;
  const reserveUsd = typeof reserveRaw === 'string' ? Number(reserveRaw) : null;
  return {
    address,
    baseTokenId,
    quoteTokenId,
    baseMint,
    quoteMint,
    reserveUsd: Number.isFinite(reserveUsd) ? (reserveUsd as number) : null,
  };
}

// ─── pool resolution ─────────────────────────────────────────

/**
 * Resolve a token mint to a GeckoTerminal pool, preferring a stable
 * USD-quote (USDC/USDT) pair and otherwise the largest SOL-quoted pool.
 * Cached per mint for the process lifetime; the keyless public tier is
 * rate-limited so repeated lookups would otherwise be the dominant cost.
 *
 * Returns null only when GeckoTerminal answered 200 with no usable pools.
 * HTTP/network failures (429, 5xx, timeout) are thrown so the caller can
 * report `error` instead of a misleading `pool-not-found`.
 */
async function resolvePool(
  mint: string,
  f: FetchFn,
  timeoutMs: number,
): Promise<GtPoolRef | null> {
  const cached = poolCache.get(mint);
  if (cached !== undefined) return cached;

  const page1 = (await gtGetJson(
    `/networks/solana/tokens/${encodeURIComponent(mint)}/pools?page=1`,
    { timeoutMs, fetchFn: f },
  )) as { data?: GtPoolRaw[]; __httpStatus?: number; __body?: string } | null;
  if (typeof page1?.__httpStatus === 'number') {
    throw new Error(
      `GeckoTerminal token→pools HTTP ${page1.__httpStatus} for ${mint.slice(0, 12)}…` +
        (page1.__body ? ` (${page1.__body.slice(0, 120)})` : ''),
    );
  }
  const data = Array.isArray(page1?.data) ? page1.data : [];
  if (data.length === 0) {
    poolCache.set(mint, null);
    return null;
  }

  const pools = data
    .map(parsePoolRaw)
    .filter((p): p is GtPoolRef => p !== null)
    .filter((p) => p.baseMint === mint || p.quoteMint === mint);

  if (pools.length === 0) {
    poolCache.set(mint, null);
    return null;
  }

  // Score: USD-quote first, then SOL-quote, then liquidity desc.
  const score = (p: GtPoolRef): number => {
    let s = 0;
    if (p.baseMint === USDC_MINT || p.quoteMint === USDC_MINT) s += 4;
    else if (p.baseMint === SOL_MINT || p.quoteMint === SOL_MINT) s += 2;
    s += Math.min(p.reserveUsd ?? 0, 1e12) / 1e12;
    return s;
  };
  const sorted = [...pools].sort((a, b) => score(b) - score(a));
  const pool = sorted[0] ?? null;
  poolCache.set(mint, pool);
  return pool;
}

// ─── OHLCV fetch ─────────────────────────────────────────────

interface GtOhlcvRaw {
  data?: {
    attributes?: { ohlcv_list?: number[][] };
    meta?: { base?: { address?: string } };
  };
  errors?: Array<{ status?: string; title?: string }>;
  __httpStatus?: number;
  __body?: string;
}

async function fetchPoolBars(
  pool: GtPoolRef,
  atSec: number,
  timeframe: OhlcvTimeframe,
  f: FetchFn,
  timeoutMs: number,
): Promise<{ bars: OhlcvBar[]; rawStatus: number; rawBody?: string }> {
  // before_timestamp returns bars ending at/just-before atSec; limit=1000
  // gives a deep enough window for the "latest bar at-or-before" picker.
  const path =
    `/networks/solana/pools/${encodeURIComponent(pool.address)}/ohlcv/${timeframe}` +
    `?before_timestamp=${atSec}&limit=1000`;
  const raw = (await gtGetJson(path, { timeoutMs, fetchFn: f })) as GtOhlcvRaw;
  if (typeof raw?.__httpStatus === 'number') {
    return { bars: [], rawStatus: raw.__httpStatus, rawBody: raw.__body };
  }
  const list = raw?.data?.attributes?.ohlcv_list;
  const bars: OhlcvBar[] = (Array.isArray(list) ? list : [])
    .filter((b) => Array.isArray(b) && b.length >= 5)
    .map((b) => ({
      time: Number(b[0]),
      open: Number(b[1]),
      high: Number(b[2]),
      low: Number(b[3]),
      close: Number(b[4]),
      volume: Number(b[5] ?? 0),
    }))
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close));
  bars.sort((a, b) => a.time - b.time);
  return { bars, rawStatus: 200 };
}

/** A token's OHLCV series plus the pool that produced it. */
export interface TokenBarSeries {
  bars: OhlcvBar[];
  /** Pool address the bars came from, or null when no pool resolved. */
  poolAddress: string | null;
  /** Honest provenance, same vocabulary as fetchHistoricalTokenUsd. */
  source: string;
}

/**
 * Fetch a token's own OHLCV series (not a single price), newest bars last.
 *
 * Needed by any caller that must measure a forward return — e.g. a backtest
 * comparing an entry bar to the bar N hours later. Using one point-in-time
 * price would answer a different question ("what is it worth now?"), which is
 * exactly the mistake the old audit-backtest made.
 *
 * NEVER throws: failures return an empty series with an explanatory source.
 */
export async function fetchTokenBarSeries(
  contract: string,
  opts: { timeframe?: OhlcvTimeframe; atMs?: number; fetchFn?: FetchFn; timeoutMs?: number } = {},
): Promise<TokenBarSeries> {
  const f = opts.fetchFn ?? http()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const atMs = opts.atMs ?? Date.now()
  const timeframe = opts.timeframe ?? 'hour'
  if (!contract) return { bars: [], poolAddress: null, source: 'error' }

  let pool: GtPoolRef | null = null
  try {
    pool = await resolvePool(contract, f, timeoutMs)
  } catch (err) {
    // A thrown resolvePool means the lookup FAILED (rate limit, HTTP error),
    // which is not the same as "this token has no pool". Reporting pool-not-found
    // here would hide a 429 and make a working token look unpriceable.
    const message = err instanceof Error ? err.message : String(err)
    const rateLimited = message.includes('429')
    return {
      bars: [],
      poolAddress: null,
      source: rateLimited ? 'geckoterminal:rate-limited' : 'error',
    }
  }
  if (!pool) return { bars: [], poolAddress: null, source: 'geckoterminal:pool-not-found' }

  const atSec = Number.isFinite(atMs) && atMs > 0 ? Math.floor(atMs / 1000) : Math.floor(Date.now() / 1000)
  const res = await fetchPoolBars(pool, atSec, timeframe, f, timeoutMs).catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[gt] ohlcv fetch threw for ${pool.address.slice(0, 10)}…: ${message}`)
    return null
  })
  if (!res) return { bars: [], poolAddress: pool.address, source: 'error' }
  if (res.rawStatus === 429) {
    console.error(`[gt] ohlcv 429 for ${pool.address.slice(0, 10)}… — rate limit`)
    return { bars: [], poolAddress: pool.address, source: 'geckoterminal:rate-limited' }
  }
  if (res.rawStatus !== 200) {
    // Name the HTTP outcome - a 404 here is "pool too new for GT".
    console.error(`[gt] ohlcv HTTP ${res.rawStatus} for ${pool.address.slice(0, 10)}…`)
    return { bars: [], poolAddress: pool.address, source: 'error' }
  }
  return { bars: res.bars, poolAddress: pool.address, source: 'geckoterminal:ohlcv' }
}
/**
 * NEVER throws: every failure path returns `{usd:null, source:'error',
 * note}`. Source strings are the honest provenance the caller can audit:
 *   geckoterminal:sol-native      — SOL mint, close of the SOL/USDC bar
 *   geckoterminal:usd-quote       — token/USDC-ish pool, close is USD
 *   geckoterminal:sol-quoted      — token/SOL pool, close is USD (GT default)
 *   geckoterminal:pool-not-found  — token has no keyless-resolvable pool
 *   error                         — network/HTTP/parse failure
 */
export async function fetchHistoricalTokenUsd(
  contract: string,
  atMs: number,
  opts: HistoricalPriceOptions = {},
): Promise<HistoricalPriceResult> {
  const f = opts.fetchFn ?? http();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const atSec = Math.floor(atMs / 1000);

  if (!contract || !Number.isFinite(atMs) || atMs <= 0) {
    return {
      usd: null,
      source: 'error',
      atMs,
      note: `invalid input (contract=${contract ? 'set' : 'empty'}, atMs=${atMs})`,
    };
  }

  // Default timeframe by age — coarse enough to find a containing bar for
  // old trades without hammering the minute endpoint (deeper retention).
  let timeframe = opts.timeframe;
  if (!timeframe) {
    const ageMs = Math.max(0, Date.now() - atMs);
    timeframe = ageMs < 3 * 86_400_000 ? 'minute' : ageMs < 180 * 86_400_000 ? 'hour' : 'day';
  }
  const intervalSeconds = timeframe === 'minute' ? 60 : timeframe === 'hour' ? 3_600 : 86_400;

  try {
    // SOL mint: price directly from the SOL/USDC pool (same OHLCV path).
    if (contract === SOL_MINT) {
      const solPool = await resolvePool(SOL_MINT, f, timeoutMs);
      if (!solPool) {
        return { usd: null, source: 'error', atMs, note: 'no SOL/USDC pool resolvable on GeckoTerminal' };
      }
      const { bars, rawStatus, rawBody } = await fetchPoolBars(
        solPool, atSec, timeframe, f, timeoutMs,
      );
      const bar = pickBarForTimestamp(bars, atMs, intervalSeconds);
      if (bar) {
        return {
          usd: bar.close,
          source: 'geckoterminal:sol-native',
          atMs,
          note: `SOL/USDC ${timeframe} close at bar ${bar.time}`,
        };
      }
      return {
        usd: null,
        source: 'error',
        atMs,
        note: `no SOL bar at/just-before ${atSec} (http=${rawStatus}${rawBody ? `, body=${rawBody.slice(0, 120)}` : ''})`,
      };
    }

    const pool = await resolvePool(contract, f, timeoutMs);
    if (!pool) {
      return {
        usd: null,
        source: 'geckoterminal:pool-not-found',
        atMs,
        note: `token ${contract.slice(0, 12)}… has no keyless GeckoTerminal pool`,
      };
    }

    const { bars, rawStatus, rawBody } = await fetchPoolBars(
      pool, atSec, timeframe, f, timeoutMs,
    );
    const bar = pickBarForTimestamp(bars, atMs, intervalSeconds);
    if (!bar) {
      return {
        usd: null,
        source: 'error',
        atMs,
        note: `no bar at/just-before ${atSec} for pool ${pool.address.slice(0, 12)}… (http=${rawStatus}${rawBody ? `, body=${rawBody.slice(0, 120)}` : ''})`,
      };
    }

    // GeckoTerminal OHLCV close is USD by default (currency=usd), even for
    // SOL-quoted pools — verified live against base_token_price_usd. Report
    // which orientation produced it for provenance; no arithmetic needed.
    const source = pool.baseMint === USDC_MINT || pool.quoteMint === USDC_MINT
      ? 'geckoterminal:usd-quote'
      : 'geckoterminal:sol-quoted';
    return {
      usd: bar.close,
      source,
      atMs,
      note: `${pool.baseMint.slice(0, 8)}…/${pool.quoteMint.slice(0, 8)}… ${timeframe} close at bar ${bar.time}`,
    };
  } catch (e) {
    return {
      usd: null,
      source: 'error',
      atMs,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}
