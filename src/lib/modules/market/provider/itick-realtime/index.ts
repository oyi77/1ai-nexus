// ─────────────────────────────────────────────────────────────
// iTick Realtime Provider (IDX quotes) — env-keyed adapter.
//
// Env:
//   ITICK_API_KEY       required; adapter disabled without it
//   ITICK_QUOTE_URL     optional override of the quote endpoint
//                       template; {symbol} is replaced. Default
//                       https://api.itick.org/rest/quote?symbol={symbol}&market=IDX
//
// Disabled state is a first-class result: callers render a clear
// "realtime not configured" state instead of failing.
// SERVER-ONLY.
// ─────────────────────────────────────────────────────────────

export interface RealtimeQuote {
  symbol: string
  price: number
  change?: number
  ts: number
  source: 'itick'
}

export function isRealtimeEnabled(): boolean {
  return Boolean(process.env.ITICK_API_KEY)
}

async function fetchItick(symbol: string): Promise<RealtimeQuote | null> {
  const key = process.env.ITICK_API_KEY
  if (!key) return null
  const tpl =
    process.env.ITICK_QUOTE_URL ??
    'https://api.itick.org/rest/quote?symbol={symbol}&market=IDX'
  const url = tpl.replace('{symbol}', encodeURIComponent(symbol))
  const res = await fetch(url, {
    headers: { token: key, Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`itick HTTP ${res.status}`)
  const j = (await res.json()) as { data?: Record<string, unknown> }
  const d = j.data ?? (j as Record<string, unknown>)
  const price = Number(d.price ?? d.last ?? d.close ?? NaN)
  if (!Number.isFinite(price)) return null
  return {
    symbol,
    price,
    change: Number.isFinite(Number(d.change)) ? Number(d.change) : undefined,
    ts: Number(d.ts ?? Date.now()),
    source: 'itick',
  }
}

/**
 * Best-effort realtime quote. Returns { enabled:false } when the
 * key is absent, and never throws — realtime is an enhancement,
 * not a hard dependency.
 */
export async function getRealtimeQuote(
  symbol: string,
): Promise<{ enabled: boolean; quote?: RealtimeQuote; error?: string }> {
  if (!isRealtimeEnabled()) return { enabled: false }
  try {
    // Accept bare code or .JK form; iTick IDX market expects bare code.
    const q = await fetchItick(symbol.replace('.JK', '').toUpperCase())
    return q ? { enabled: true, quote: q } : { enabled: true, error: 'empty quote payload' }
  } catch (e) {
    return { enabled: true, error: String((e as Error).message ?? e).slice(0, 140) }
  }
}
