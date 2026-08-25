// ─────────────────────────────────────────────────────────────
// Binance Top-Symbols Provider — derives the active top-N USDT
// perpetuals by quote volume, replacing static UI tab lists.
//
// SERVER-SAFE (no fs); upstream fapi.binance.com.
// ─────────────────────────────────────────────────────────────

const FAPI_TICKERS = 'https://fapi.binance.com/fapi/v1/ticker/24hr'

// Stable/pegged and leveraged-token bases never belong in tab strips.
const EXCLUDED_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'USDP', 'BUSD', 'USDD', 'SUSD', 'DAI', 'EUR', 'AEUR', 'XUSD',
])
const LEVERAGED_SUFFIX = /(UP|DOWN|BULL|BEAR)$/

export interface TopSymbol {
  symbol: string // base, e.g. BTC
  quoteVolume: number
}

function baseOf(pair: string): string | null {
  if (!pair.endsWith('USDT')) return null
  const base = pair.slice(0, -4)
  if (!/^[A-Z0-9]{2,10}$/.test(base)) return null
  if (EXCLUDED_BASES.has(base) || LEVERAGED_SUFFIX.test(base)) return null
  return base
}

export async function fetchTopCryptoSymbols(n = 9): Promise<TopSymbol[]> {
  const res = await fetch(FAPI_TICKERS, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`binance HTTP ${res.status}`)
  const rows = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>
  const mapped = rows
    .map((r) => ({ pair: r.symbol as string | null, base: baseOf(r.symbol), qv: Number(r.quoteVolume) }))
    .filter((x): x is { pair: string; base: string; qv: number } => x.base !== null && Number.isFinite(x.qv))
  const deduped = new Map<string, number>()
  for (const x of mapped) {
    const prev = deduped.get(x.base) ?? 0
    if (x.qv > prev) deduped.set(x.base, x.qv)
  }
  return [...deduped.entries()]
    .map(([symbol, quoteVolume]) => ({ symbol, quoteVolume }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, n)
}
