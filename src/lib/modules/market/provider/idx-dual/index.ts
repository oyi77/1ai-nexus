// ─────────────────────────────────────────────────────────────
// US-IDX dual listings — Indonesian companies trading abroad.
// Live-verified 2026-09-16:
// - TLK present in FOREIGN_STOCK codes + asset/info (price $14.78)
//   but ABSENT from the US RSC universe (887 large-caps only) —
//   so the US leg reads asset/info, not the universe.
// - IDX leg from IdxSahamSession closes.
// SERVER-ONLY. Consume via /api/v1/saham/dual?symbol=TLKM.
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'

const INFO_BASE = 'https://external-api.ajaib.co.id/api/v1/public/investment-experience/asset/info'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const CACHE_TTL = 60 * 60_000

/** IDX code -> US ticker (ADR/ordinary). Curated 2026-09-16. */
export const DUAL_MAP: Record<string, string> = {
  TLKM: 'TLK', // Telkom Indonesia ADR (NYSE)
}

export interface DualQuote {
  idx: string
  us: string
  idxClose: number | null
  usPrice: number | null
  usDayPct: number | null
  note: string
}

async function fetchForeignInfo(code: string): Promise<{ price: number | null; dayPct: number | null }> {
  const res = await fetch(`${INFO_BASE}?asset_type=FOREIGN_STOCK&code=${code}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': IPHONE_UA, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Ajaib foreign info HTTP ${res.status} for ${code}`)
  const body = (await res.json()) as {
    err_code?: string
    result?: { price?: number; change_pct?: number }
  }
  if (body.err_code !== 'EC0000000' || !body.result) return { price: null, dayPct: null }
  const price = typeof body.result.price === 'number' ? body.result.price : null
  const dayPct = typeof body.result.change_pct === 'number' ? body.result.change_pct : null
  return { price, dayPct }
}

export async function getDualQuote(input: string): Promise<DualQuote | null> {
  const code = input.trim().toUpperCase().replace(/\.JK$/, '')
  const us = DUAL_MAP[code]
  if (!us) return null
  const { data } = await getCached(`dual:${code}:v1`, CACHE_TTL, async () => {
    const [foreign, idxRow] = await Promise.all([
      fetchForeignInfo(us).catch(() => ({ price: null as number | null, dayPct: null as number | null })),
      prisma.idxSahamSession.findFirst({
        where: { code },
        orderBy: { tradeDate: 'desc' },
        select: { close: true },
      }),
    ])
    const out: DualQuote = {
      idx: code,
      us,
      idxClose: idxRow?.close ?? null,
      usPrice: foreign.price,
      usDayPct: foreign.dayPct,
      note: 'US price in USD, IDX close in IDR — ratio is informational, not FX-adjusted',
    }
    return out
  })
  return data
}

export function listDuals(): Array<{ idx: string; us: string }> {
  return Object.entries(DUAL_MAP).map(([idx, us]) => ({ idx, us }))
}
