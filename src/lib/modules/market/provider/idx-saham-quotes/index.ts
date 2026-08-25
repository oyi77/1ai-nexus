// ─────────────────────────────────────────────────────────────
// IDX Saham Latest-Quotes — serves the harvested session's OHLCV
// as an instant quote layer for the IDX slice of the universe,
// eliminating cold-cache Yahoo hammering on /equities.
//
// Reads data/idx/saham-latest.json (written daily by
// harvest:idx-saham). SERVER-ONLY.
// ─────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const FILE = join(process.cwd(), 'data', 'idx', 'saham-latest.json')

export interface SahamQuote {
  close: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  volume: number
  value: number
  freq: number
}

export interface SahamQuotesResult {
  tradeDate: string
  capturedAt: string
  quotes: Record<string, SahamQuote> // keyed by bare code AND .JK symbol
}

const Schema = z.object({
  capturedAt: z.string(),
  tradeDate: z.string(),
  rows: z.array(z.object({
    code: z.string(),
    prev: z.number(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    change: z.number(),
    volume: z.number(),
    value: z.number(),
    freq: z.number(),
  })),
})

let cache: { at: number; data: SahamQuotesResult } | null = null
const TTL = 5 * 60_000

export async function getSahamLatestQuotes(): Promise<SahamQuotesResult> {
  if (cache && Date.now() - cache.at < TTL) return cache.data
  const parsed = Schema.parse(JSON.parse(await readFile(FILE, 'utf8')))
  const quotes: Record<string, SahamQuote> = {}
  for (const r of parsed.rows) {
    const q: SahamQuote = {
      close: r.close,
      change: r.change,
      changePct: r.prev > 0 ? ((r.close - r.prev) / r.prev) * 100 : 0,
      open: r.open,
      high: r.high,
      low: r.low,
      volume: r.volume,
      value: r.value,
      freq: r.freq,
    }
    quotes[r.code] = q
    quotes[`${r.code}.JK`] = q
  }
  cache = { at: Date.now(), data: { tradeDate: parsed.tradeDate, capturedAt: parsed.capturedAt, quotes } }
  return cache.data
}
