// ─────────────────────────────────────────────────────────────
// DexScreener token metadata resolvers — symbol / market cap /
// liquidity for mints that the DB tables (Token, LaunchToken) do
// not carry. Used by accumulation-alert loadMarkets so the named
// alert AND the market-cap gate see the same numbers.
//
// Endpoint: GET /tokens/v1/solana/{addr,addr,…} — comma-separated
// batch (≤30 addresses per DexScreener docs; 10 is our ceiling).
// Response: flat array of pair objects (see sniper-scan-discover
// DexPair shape, verified live for Meteora/Raydium pairs).
//
// Discipline (mirrors wallet-discovery / hydrateFromDexscreener):
//   · a failed batch is tolerated — never throws;
//   · a mint with no pairs stays absent from the map (no fabrication);
//   · one pair per mint — the highest liquidity.usd wins, since MC
//     and liquidity are per-pair while symbol is per-token.
// Pure parse + one impure fetch. Zero DB.
// ─────────────────────────────────────────────────────────────

export interface DexPairLite {
  chainId?: string
  marketCap?: number
  fdv?: number
  pairCreatedAt?: number
  volume?: Record<string, number>
  baseToken?: { address?: string; symbol?: string }
  liquidity?: { usd?: number }
}

export interface TokenMeta {
  symbol: string | null
  marketCapUsd: number | null
  liquidityUsd: number | null
  /** Pair creation epoch-ms — pair age gates need this; null when absent. */
  pairCreatedAtMs: number | null
  /** 24h traded volume USD on the winning pair; null when absent. */
  volume24hUsd: number | null
}

/** A market row as stored by the alert's callers. */
export interface MarketRow {
  symbol: string | null
  marketCapUsd: number | null
  liquidityUsd: number | null
  pairCreatedAtMs: number | null
  volume24hUsd: number | null
}

/**
 * True when a DB row carries no usable market truth and must be filled
 * from the market API. `token-holdings-persist` creates `Token` rows with
 * `symbol = address.slice(0, 6).toUpperCase()` and the schema defaults
 * `marketCap` to 0 — a placeholder, not data. Trusting it renders
 * `$HG5JA5` for a token whose real ticker is `baton`, and a 0/null cap
 * silently bypasses the max-market-cap gate.
 */
export function isPlaceholderRow(address: string, row: MarketRow): boolean {
  const pseudo = address.slice(0, 6).toUpperCase()
  const sym = (row.symbol ?? '').trim().toUpperCase()
  if (sym === '' || sym === pseudo) return true
  if (row.marketCapUsd === null || !(row.marketCapUsd > 0)) return true
  return false
}

/**
 * Merge a DB row with API metadata FIELD BY FIELD: real DB values win,
 * placeholders and gaps are filled. A missing API row leaves the DB row
 * untouched (absent ≠ zero).
 */
export function mergeWithDex(
  address: string,
  db: MarketRow,
  dex: TokenMeta | undefined,
): MarketRow {
  if (!dex) return db
  const pseudo = address.slice(0, 6).toUpperCase()
  const dbSym = (db.symbol ?? '').trim()
  const symbolUsable = dbSym !== '' && dbSym.toUpperCase() !== pseudo
  return {
    symbol: symbolUsable ? dbSym : (dex.symbol ?? null),
    marketCapUsd: db.marketCapUsd !== null && db.marketCapUsd > 0 ? db.marketCapUsd : dex.marketCapUsd,
    liquidityUsd: db.liquidityUsd !== null ? db.liquidityUsd : dex.liquidityUsd,
    pairCreatedAtMs: db.pairCreatedAtMs ?? dex.pairCreatedAtMs,
    volume24hUsd: db.volume24hUsd ?? dex.volume24hUsd,
  }
}

/** Batch ceiling — one URL per request group. */
const BATCH = 10
const TIMEOUT_MS = 10_000

/**
 * Parse a flat pairs array into per-mint metadata. One pair per mint:
 * highest liquidity.usd wins (MC/liquidity are per-pair; symbol is
 * derived from baseToken). Contracts with no resolvable pair stay out.
 * Pure, exported for tests.
 */
export function parseDexPairs(contracts: string[], pairs: DexPairLite[]): Map<string, TokenMeta> {
  const wanted = new Set(contracts)
  const best = new Map<string, { pair: DexPairLite; liq: number }>()
  for (const p of pairs) {
    // The API can return null/garbage entries; one bad row must not kill
    // the whole batch (the caller has no other enrichment source).
    if (p === null || typeof p !== 'object') continue
    const addr = p.baseToken?.address
    if (!addr || typeof addr !== 'string' || !wanted.has(addr)) continue
    const liq = typeof p.liquidity?.usd === 'number' && Number.isFinite(p.liquidity.usd) ? p.liquidity.usd : 0
    const cur = best.get(addr)
    if (!cur || liq > cur.liq) best.set(addr, { pair: p, liq })
  }
  const out = new Map<string, TokenMeta>()
  for (const [addr, { pair }] of best) {
    const sym = pair.baseToken?.symbol
    const mc = typeof pair.marketCap === 'number' && pair.marketCap > 0 ? pair.marketCap
      : typeof pair.fdv === 'number' && pair.fdv > 0 ? pair.fdv
      : null
    const created = pair.pairCreatedAt
    const vol24 = pair.volume?.h24
    out.set(addr, {
      symbol: typeof sym === 'string' && sym.trim() !== '' ? sym : null,
      marketCapUsd: mc,
      liquidityUsd: typeof pair.liquidity?.usd === 'number' && Number.isFinite(pair.liquidity.usd) ? pair.liquidity.usd : null,
      pairCreatedAtMs: typeof created === 'number' && Number.isFinite(created) && created > 0 ? created : null,
      volume24hUsd: typeof vol24 === 'number' && Number.isFinite(vol24) ? vol24 : null,
    })
  }
  return out
}

/**
 * Fetch token metadata for up to N contracts in ≤30-sized batches.
 * Contracts the API knows nothing about are absent from the result —
 * callers must treat "absent" as unverified, never as zero.
 * Never throws.
 */
export async function fetchDexTokenMeta(contracts: string[]): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>()
  const uniq = [...new Set(contracts.filter((c) => typeof c === 'string' && c.length > 0))]
  if (uniq.length === 0) return out

  const batches: string[][] = []
  for (let i = 0; i < uniq.length; i += BATCH) batches.push(uniq.slice(i, i + BATCH))

  const results = await Promise.allSettled(
    batches.map(async (group) => {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${group.join(',')}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`dexscreener ${res.status}`)
      return (await res.json()) as DexPairLite[]
    }),
  )

  for (const r of results) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue
    for (const [addr, meta] of parseDexPairs(uniq, r.value)) out.set(addr, meta)
  }
  return out
}
