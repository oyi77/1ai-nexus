// ─────────────────────────────────────────────────────────────
// IDX Saham Latest-Quotes — serves the harvested session's OHLCV
// as an instant quote layer for the IDX slice of the universe,
// eliminating cold-cache Yahoo hammering on /equities.
//
// Reads IdxSahamSession via Prisma. SERVER-ONLY.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

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

let cache: { at: number; data: SahamQuotesResult } | null = null
const TTL = 5 * 60_000

export async function getSahamLatestQuotes(): Promise<SahamQuotesResult> {
  if (cache && Date.now() - cache.at < TTL) return cache.data

  const latest = await prisma.idxSahamSession.findFirst({
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  })
  if (!latest) {
    const empty: SahamQuotesResult = { tradeDate: '', capturedAt: new Date().toISOString(), quotes: {} }
    cache = { at: Date.now(), data: empty }
    return cache.data
  }

  const rows = await prisma.idxSahamSession.findMany({
    where: { tradeDate: latest.tradeDate },
  })

  const quotes: Record<string, SahamQuote> = {}
  for (const r of rows) {
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
  cache = { at: Date.now(), data: { tradeDate: latest.tradeDate, capturedAt: new Date().toISOString(), quotes } }
  return cache.data
}
