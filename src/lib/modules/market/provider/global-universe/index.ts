// ─────────────────────────────────────────────────────────────
// Global Universe Provider — full listed-equity universes for the
// world's major markets via TradingView scanners (same free,
// keyless RE as the IDX universe).
//
//   https://scanner.tradingview.com/{tv}/scan
//   filter type=stock · columns [name, description]
//
// Symbols are rebuilt for Yahoo Finance by translating the TV
// exchange prefix (NASDAQ:, LSE:, TSE:, …) into the proper quote
// suffix ('', '.L', '.T', …). Unknown prefixes are skipped and
// counted — never silently mis-mapped.
//
// SERVER-SAFE (network only, cached via server-cache).
// ─────────────────────────────────────────────────────────────

import { z } from 'zod'
import { getCached } from '@/lib/api/server-cache'

export interface GlobalMarketDef {
  tv: string // scanner slug
  name: string
  /** TV exchange-prefix (before ':') → Yahoo quote suffix */
  prefixes: Record<string, string>
}

export const GLOBAL_MARKETS: Record<string, GlobalMarketDef> = {
  us: { tv: 'america', name: 'United States', prefixes: { NASDAQ: '', NYSE: '', AMEX: '', NYSEARCA: '', BATS: '' } },
  japan: { tv: 'japan', name: 'Japan', prefixes: { TSE: '.T' } },
  uk: { tv: 'uk', name: 'United Kingdom', prefixes: { LSE: '.L' } },
  germany: { tv: 'germany', name: 'Germany (XETRA)', prefixes: { XETR: '.DE' } },
  hongkong: { tv: 'hongkong', name: 'Hong Kong', prefixes: { HKEX: '.HK' } },
  india: { tv: 'india', name: 'India', prefixes: { NSE: '.NS', BSE: '.BO' } },
  canada: { tv: 'canada', name: 'Canada', prefixes: { TSX: '.TO', TSXV: '.V', NEO: '.NEO' } },
  korea: { tv: 'korea', name: 'South Korea', prefixes: { KRX: '.KS', KOSDAQ: '.KQ' } },
  taiwan: { tv: 'taiwan', name: 'Taiwan', prefixes: { TWSE: '.TW', TPEX: '.TWO' } },
  australia: { tv: 'australia', name: 'Australia', prefixes: { ASX: '.AX' } },
  singapore: { tv: 'singapore', name: 'Singapore', prefixes: { SGX: '.SI' } },
  brazil: { tv: 'brazil', name: 'Brazil', prefixes: { BMFBOVESPA: '.SA' } },
  switzerland: { tv: 'switzerland', name: 'Switzerland', prefixes: { SIX: '.SW' } },
  netherlands: { tv: 'netherlands', name: 'Netherlands', prefixes: { EURONEXT: '.AS' } },
}

const MAX_ROWS = 20_000

const ScanResponse = z.object({
  totalCount: z.number(),
  data: z.array(z.object({ s: z.string(), d: z.unknown().optional() })),
})

export interface GlobalUniverseStock {
  symbol: string
  name: string
  exchange: string // TV prefix, e.g. NASDAQ
}

export interface GlobalUniverse {
  marketId: string
  marketName: string
  stocks: GlobalUniverseStock[]
  meta: {
    source: string
    totalCount: number
    captured: number
    skippedUnknownPrefix: number
    /** rows dropped because the symbol already appeared on an earlier page */
    deduped: number
    fetchedAt: string
  }
}

async function loadMarket(def: GlobalMarketDef): Promise<GlobalUniverse> {
  const stocks: GlobalUniverseStock[] = []
  let skipped = 0
  const seen = new Set<string>()
  let deduped = 0

  // Single oversized request returns the ENTIRE market exactly once — probed:
  // [0,20000] on america → 11867 rows == totalCount == unique. Windowed
  // pagination is unusable: TV reshuffles ordering between requests, so deep
  // pages repeat earlier rows (hk page3 shared 1354 symbols with pages 1-2).
  // data:null only occurs when range start >= totalCount, impossible here.
  const scanBase = {
    filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
    options: { lang: 'en' },
    range: [0, MAX_ROWS],
  }
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  }

  // Some markets reject the 'description' column with HTTP 400 → name-only.
  let res = await fetch(`https://scanner.tradingview.com/${def.tv}/scan`, {
    method: 'POST',
    signal: AbortSignal.timeout(40_000),
    headers,
    body: JSON.stringify({ ...scanBase, columns: ['name', 'description'] }),
  })
  if (res.status === 400) {
    res = await fetch(`https://scanner.tradingview.com/${def.tv}/scan`, {
      method: 'POST',
      signal: AbortSignal.timeout(40_000),
      headers,
      body: JSON.stringify({ ...scanBase, columns: ['name'] }),
    })
  }
  if (!res.ok) throw new Error(`${def.tv} scan HTTP ${res.status}`)
  const parsed = ScanResponse.parse(await res.json())

  for (const row of parsed.data) {
    const colon = row.s.indexOf(':')
    const prefix = colon > 0 ? row.s.slice(0, colon) : ''
    const d = Array.isArray(row.d) ? (row.d as string[]) : []
    const base = (d[0] || (colon > 0 ? row.s.slice(colon + 1) : row.s)).trim()
    if (!(prefix in def.prefixes)) {
      skipped++
      continue
    }
    if (!base) continue
    const symbol = `${base}${def.prefixes[prefix]}`
    if (seen.has(symbol)) {
      deduped++
      continue
    }
    seen.add(symbol)
    stocks.push({ symbol, name: d[1] ?? base, exchange: prefix })
  }

  return {
    marketId: def.tv,
    marketName: def.name,
    stocks,
    meta: {
      source: `tradingview-${def.tv}-scan`,
      totalCount: parsed.totalCount,
      captured: stocks.length,
      skippedUnknownPrefix: skipped,
      deduped,
      fetchedAt: new Date().toISOString(),
    },
  }
}


/** Cached per-market universe (24h TTL — listings change rarely). */
export async function getGlobalUniverse(marketId: string): Promise<GlobalUniverse> {
  const def = GLOBAL_MARKETS[marketId]
  if (!def) throw new Error(`Unknown market '${marketId}'. Available: ${Object.keys(GLOBAL_MARKETS).join(', ')}`)
  const { data } = await getCached(`global-universe:${marketId}:v5`, 24 * 60 * 60 * 1000, () => loadMarket(def))
  return data
}
/** Market catalog for UI pickers / discovery. */
export function getGlobalMarketCatalog(): Array<{ id: string; name: string }> {
  return Object.entries(GLOBAL_MARKETS).map(([id, def]) => ({ id, name: def.name }))
}
