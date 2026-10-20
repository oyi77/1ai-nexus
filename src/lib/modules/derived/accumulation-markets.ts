// ─────────────────────────────────────────────────────────────
// Market metadata for accumulation alerts — DB-first with live
// DexScreener fallback. Extracted from accumulation-alert-cron
// so tests exercise the same code path the cron runs.
//
// Layers:
//   1. Token (holdings persist) + LaunchToken (launch engine).
//   2. Placeholder rows — token-holdings creates `Token` with
//      symbol = address.slice(0, 6).toUpperCase() and marketCap
//      defaulting to 0 — count as "no data", never as truth.
//   3. Missing or placeholder rows are filled field-by-field from
//      DexScreener tokens/v1 (deepest pair per mint).
//
// Without layer 3 a null market cap silently bypasses the
// `>= maxMarketCapUsd` gate in buildAccumulationEvents, delivering
// multi-million-dollar caps the spec excludes. Never throws: a
// failed DB or network leg degrades, it does not zero the run.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { fetchDexTokenMeta, mergeWithDex } from './dex-token-meta'
import type { MarketRow } from './dex-token-meta'

export type { MarketRow }

export async function loadMarkets(candidates: Array<{ contract: string }>): Promise<Map<string, MarketRow>> {
  const map = new Map<string, MarketRow>()
  try {
    const contracts = [...new Set(candidates.map((c) => c.contract))]
    const tokens = await prisma.token.findMany({
      where: { address: { in: contracts }, chain: { in: ['solana'] } },
      select: { address: true, chain: true, symbol: true, marketCap: true },
    })
    for (const t of tokens) {
      map.set(t.address, {
        marketCapUsd: t.marketCap,
        liquidityUsd: null,
        symbol: t.symbol,
        pairCreatedAtMs: null,
        volume24hUsd: null,
      })
    }
    // LaunchToken is the only schema model with liquidityUsd; prefer it
    // for the same mint when present (it also carries a fresher MC).
    const launches = await prisma.launchToken.findMany({
      where: { address: { in: contracts }, chain: { in: ['solana'] } },
      select: { address: true, chain: true, symbol: true, marketCapUsd: true, liquidityUsd: true },
    })
    for (const l of launches) {
      map.set(l.address, {
        marketCapUsd: l.marketCapUsd,
        liquidityUsd: l.liquidityUsd,
        symbol: l.symbol,
        pairCreatedAtMs: null,
        volume24hUsd: null,
      })
    }

    // Layer 3: the market API. Runs for EVERY contract, not only the
    // missing/placeholder ones, because pair age and 24h volume exist
    // nowhere in the DB — the strategy gates cannot run without them.
    // mergeWithDex keeps real DB values and fills only gaps.
    if (contracts.length > 0) {
      const meta = await fetchDexTokenMeta(contracts)
      let resolved = 0
      for (const addr of contracts) {
        const dex = meta.get(addr)
        if (!dex) continue
        const db = map.get(addr) ?? {
          marketCapUsd: null,
          liquidityUsd: null,
          symbol: null,
          pairCreatedAtMs: null,
          volume24hUsd: null,
        }
        map.set(addr, mergeWithDex(addr, db, dex))
        resolved++
      }
      if (resolved > 0) {
        console.log(`[accumulation-alert] dexscreener enrichment: ${resolved}/${contracts.length} market row(s) resolved`)
      }
    }
  } catch (err) {
    console.error(`[accumulation-alert] market query failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return map
}
