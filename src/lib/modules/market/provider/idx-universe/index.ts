// ─────────────────────────────────────────────────────────────
// IDX Universe Provider — dynamic list of IDX listed equities.
//
// Live source: TradingView Indonesia stock scanner (plain HTTPS,
// verified reachable server-side, ~840+ active tickers with
// company names + sectors + industries).
//
// Source ladder (first success wins):
//   1. scanner.tradingview.com/indonesia/scan (live)
//   2. data/idx/universe.json snapshot (written by
//      src/scripts/idx-universe-harvest.ts)
//   3. curated fallback floor from lib/config/universe
//
// Every stock is enriched with `icSector` (IDX-IC style taxonomy)
// via the TV_TO_IC_SECTOR translation table.
//
// SERVER-ONLY: imports node:fs — never import from client code.
// Consume via GET /api/v1/equities/universe.
// ─────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { IDX_FALLBACK, TV_TO_IC_SECTOR } from '@/lib/config/universe'
import { getCached } from '@/lib/api/server-cache'

const SNAPSHOT_FILE = join(process.cwd(), 'data', 'idx', 'universe.json')
const SCAN_URL = 'https://scanner.tradingview.com/indonesia/scan'

const CACHE_KEY = 'idx-universe:v2' // v2 adds industry + icSector
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h — listings change rarely

export interface IdxUniverseStock {
  symbol: string
  name: string
  sector?: string
  industry?: string
  icSector?: string
}

export type IdxUniverseSource = 'tradingview' | 'snapshot' | 'curated-fallback'

export interface IdxUniverse {
  stocks: IdxUniverseStock[]
  meta: {
    source: IdxUniverseSource
    count: number
    fetchedAt: string | null
    stale: boolean
  }
}

// Columns requested from the scanner, in order:
// ticker, company name, sector, industry.
const ScanResponse = z.object({
  totalCount: z.number(),
  data: z.array(z.object({
    s: z.string(),
    d: z.array(z.string()),
  })),
})

const SnapshotSchema = z.object({
  capturedAt: z.string(),
  stocks: z.array(z.object({
    symbol: z.string(),
    name: z.string(),
    sector: z.string().optional(),
    industry: z.string().optional(),
  })),
})

/** Translate TradingView sector to IDX-IC style sector (passthrough when unmapped). */
export function applyIcSector<T extends { sector?: string }>(stock: T): T & { icSector?: string } {
  if (!stock.sector) return stock
  return { ...stock, icSector: TV_TO_IC_SECTOR[stock.sector] ?? stock.sector }
}

function applyAll(stocks: IdxUniverseStock[]): IdxUniverseStock[] {
  return stocks.map(applyIcSector)
}

/** Live universe from TradingView Indonesia scanner. */
async function fetchLive(): Promise<IdxUniverseStock[]> {
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    },
    body: JSON.stringify({
      filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
      options: { lang: 'en' },
      columns: ['name', 'description', 'sector', 'industry'],
      range: [0, 3000],
    }),
  })
  if (!res.ok) throw new Error(`tradingview scan HTTP ${res.status}`)
  const parsed = ScanResponse.parse(await res.json())
  return parsed.data.map((row) => ({
    symbol: `${row.d[0] || row.s.replace('IDX:', '')}.JK`,
    name: row.d[1],
    sector: row.d[2],
    industry: row.d[3],
  }))
}

async function readSnapshot(): Promise<{ stocks: IdxUniverseStock[]; fetchedAt: string }> {
  const raw = await readFile(SNAPSHOT_FILE, 'utf8')
  const snap = SnapshotSchema.parse(JSON.parse(raw))
  return { stocks: snap.stocks, fetchedAt: snap.capturedAt }
}

function curatedFallback(): IdxUniverseStock[] {
  return IDX_FALLBACK.map(({ symbol, name }) => ({ symbol, name }))
}

async function load(): Promise<IdxUniverse> {
  try {
    const stocks = await fetchLive()
    if (stocks.length > 0) {
      return {
        stocks: applyAll(stocks),
        meta: { source: 'tradingview', count: stocks.length, fetchedAt: new Date().toISOString(), stale: false },
      }
    }
  } catch {
    // fall through to snapshot
  }

  try {
    const { stocks, fetchedAt } = await readSnapshot()
    if (stocks.length > 0) {
      const age = Date.now() - new Date(fetchedAt).getTime()
      return {
        stocks: applyAll(stocks),
        meta: { source: 'snapshot', count: stocks.length, fetchedAt, stale: age > 7 * 24 * 60 * 60 * 1000 },
      }
    }
  } catch {
    // fall through to curated floor
  }

  const stocks = applyAll(curatedFallback())
  return {
    stocks,
    meta: { source: 'curated-fallback', count: stocks.length, fetchedAt: null, stale: false },
  }
}

/** Cached accessor — one upstream hit per TTL across all callers. */
export async function getIdxUniverse(): Promise<IdxUniverse> {
  const { data } = await getCached(CACHE_KEY, CACHE_TTL_MS, load)
  return data
}
