// ─────────────────────────────────────────────────────────────
// US-IDX dual listings — Indonesian companies trading abroad.
// Live-verified 2026-09-16: TLK present in Ajaib FOREIGN_STOCK codes.
// Map is hand-curated (few pairs exist); US leg fetched live from
// the Ajaib US universe, IDX leg from IdxSahamSession closes.
// SERVER-ONLY. Consume via /api/v1/saham/dual?symbol=TLKM.
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'
import { getAjaibUS } from '@/lib/modules/market/provider/idx-ajaib/universe'

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

export async function getDualQuote(input: string): Promise<DualQuote | null> {
  const code = input.trim().toUpperCase().replace(/\.JK$/, '')
  const us = DUAL_MAP[code]
  if (!us) return null
  const { data } = await getCached(`dual:${code}:v1`, CACHE_TTL, async () => {
    const [usUni, idxRow] = await Promise.all([
      getAjaibUS().catch(() => null),
      prisma.idxSahamSession.findFirst({
        where: { code },
        orderBy: { tradeDate: 'desc' },
        select: { close: true },
      }),
    ])
    const usRow = usUni?.rows.find(r => r.code === us) ?? null
    const out: DualQuote = {
      idx: code,
      us,
      idxClose: idxRow?.close ?? null,
      usPrice: usRow?.price ?? null,
      usDayPct: usRow?.day?.pctChange ?? null,
      note: 'US price in USD, IDX close in IDR — ratio is informational, not FX-adjusted',
    }
    return out
  })
  return data
}

export function listDuals(): Array<{ idx: string; us: string }> {
  return Object.entries(DUAL_MAP).map(([idx, us]) => ({ idx, us }))
}
