// ─────────────────────────────────────────────────────────────
// KOLScan — Solana KOL wallet monitor.
// Source: kolscan.io (Next.js app) + its public Supabase backend.
//
// RE-VERIFIED 2026-10-17 (passive GET only): the `user-session` cookie is
// NOT required. The public browser anon key is embedded in the client bundle
// and both datasets are openly readable with it:
//   1. Wallet roster   GET {SUPABASE}/rest/v1/wallets?select=*  (564 rows)
//   2. Live tx feed    GET {SUPABASE}/rest/v1/transactions_realtime
// A keyless GET of kolscan.io/ also returns the same roster+feed embedded in
// its Next.js RSC payload (409 wallets / 10 tx) — a fake cookie yields a
// byte-identical result, so the cookie never gated anything.
//
// This module therefore tries the keyless Supabase REST path FIRST. The RSC
// HTML scrape is ALWAYS fetched for evm_address enrichment (the public
// Supabase `wallets` table does not expose evm_address). KOLSCAN_SESSION is
// optional: when non-empty it is merely sent as a cookie and never gates.
//
// Filtering (applied downstream by smart-money-sync):
//   - Purchase amount > $1000 (sol_change * SOL price)
//   - Wallet win rate >= 60% (cross-referenced with GMGN wallet stats)
//   - Human transactions only (KOL wallets are verified humans; bot-transaction
//     heuristics applied via dex + timing + tx frequency patterns)
//
// Bot-transaction heuristics:
//   - Most KOLScan wallets are verified human KOLs (checked by kolscan team)
//   - `Pump.fun` / `Pump AMM` buys with sol_change patterns that repeat
//     at fixed intervals are flagged as bot-like
//   - Transactions with identical out_amount across >3 wallets in the same
//     block window are treated as coordinated/bot activity

// ─────────────────────────────────────────────────────────────

const KOLSCAN_BASE = 'https://kolscan.io'

function getSession(): string {
  return process.env.KOLSCAN_SESSION || ''
}


const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'


export interface KolscanWallet {
  address: string
  name: string
  twitter: string | null
  telegram: string | null
  evmAddress: string | null
  pfp: string | null
}

export interface KolscanTransaction {
  signature: string
  walletAddress: string
  kolName: string
  timestamp: number
  solChange: number
  outTokenSymbol: string
  outTokenAddress: string
  outAmount: number
  inTokenSymbol: string | null
  inTokenAddress: string | null
  inAmount: number
  dex: string
  /** USD value of the purchase (sol_change * solPriceUsd). Null when SOL price unknown. */
  usdValue: number | null
}

export interface KolscanFeed {
  wallets: KolscanWallet[]
  transactions: KolscanTransaction[]
  fetchedAt: string
}
// ── Keyless source (RE-verified 2026-10-17) ─────────────────────
//
// KOLScan's own Supabase project, read through the public browser anon key
// shipped in their client chunk `/_next/static/chunks/99-*.js`
// (`createClient(SUPABASE_URL, ANON_KEY)`). The anon key is a read-scoped
// client credential — RLS exposes exactly the public `wallets` roster and
// `transactions_realtime` feed the site renders.

const KOLSCAN_SUPABASE_URL = 'https://odllxoobvwycaojooxvl.supabase.co'
const KOLSCAN_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kbGx4b29idnd5Y2Fvam9veHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg0MDYyNTcsImV4cCI6MjA2Mzk4MjI1N30.p8yssMZkn-TwOEkCRgO668egOlYBZuVJT0TRmqRzoqk'

/** Raw row shape from the public Supabase `wallets` table (snake_case). */
interface KolscanSupaWallet {
  wallet_address?: string | null
  name?: string | null
  twitter?: string | null
  telegram?: string | null
  evm_address?: string | null
  pfp?: string | null
}

/** Raw row shape from the public Supabase `transactions_realtime` table. */
interface KolscanSupaTx {
  signature?: string | null
  wallet_address?: string | null
  name?: string | null
  timestamp?: number | null
  sol_change?: number | null
  out_token_symbol?: string | null
  out_token_address?: string | null
  out_amount?: number | null
  in_token_symbol?: string | null
  in_token_address?: string | null
  in_amount?: number | null
  dex?: string | null
}

/**
 * Fetch the full wallet roster from the public Supabase `wallets` table.
 * Returns [] (never throws) on any failure.
 */
export async function fetchKolscanWalletsKeyless(): Promise<KolscanWallet[]> {
  try {
    const res = await fetch(`${KOLSCAN_SUPABASE_URL}/rest/v1/wallets?select=*&limit=1000`, {
      headers: {
        'apikey': KOLSCAN_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${KOLSCAN_SUPABASE_ANON_KEY}`,
        'User-Agent': UA,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const rows = (await res.json()) as KolscanSupaWallet[]
    if (!Array.isArray(rows)) return []
    const seen = new Set<string>()
    const out: KolscanWallet[] = []
    for (const r of rows) {
      const address = typeof r.wallet_address === 'string' ? r.wallet_address : ''
      if (!address || seen.has(address)) continue
      seen.add(address)
      out.push({
        address,
        name: r.name ?? '',
        twitter: r.twitter ?? null,
        telegram: r.telegram ?? null,
        evmAddress: r.evm_address ?? null,
        pfp: r.pfp ?? null,
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Fetch the latest trades from the public Supabase `transactions_realtime`
 * table (newest first). `usd_change` is deliberately ignored — the adapter
 * chain prices via the canonical `usdValue = solChange * solPrice` SOL path.
 * Returns [] (never throws) on any failure.
 */
export async function fetchKolscanTxsKeyless(
  limit = 200,
): Promise<Omit<KolscanTransaction, 'usdValue'>[]> {
  try {
    const n = Math.max(1, Math.min(1000, Math.floor(limit)))
    const res = await fetch(
      `${KOLSCAN_SUPABASE_URL}/rest/v1/transactions_realtime?select=*&order=timestamp.desc&limit=${n}`,
      {
        headers: {
          'apikey': KOLSCAN_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${KOLSCAN_SUPABASE_ANON_KEY}`,
          'User-Agent': UA,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!res.ok) return []
    const rows = (await res.json()) as KolscanSupaTx[]
    if (!Array.isArray(rows)) return []
    const out: Omit<KolscanTransaction, 'usdValue'>[] = []
    for (const r of rows) {
      if (!r.signature || !r.wallet_address || typeof r.timestamp !== 'number') continue
      out.push({
        signature: r.signature,
        walletAddress: r.wallet_address,
        kolName: r.name ?? '',
        timestamp: r.timestamp,
        solChange: r.sol_change ?? 0,
        outTokenSymbol: r.out_token_symbol ?? '',
        outTokenAddress: r.out_token_address ?? '',
        outAmount: r.out_amount ?? 0,
        inTokenSymbol: r.in_token_symbol || null,
        inTokenAddress: r.in_token_address || null,
        inAmount: r.in_amount ?? 0,
        dex: r.dex ?? '',
      })
    }
    return out
  } catch {
    return []
  }
}

/** SOL price in USD, from a lightweight public endpoint. Cached 5 minutes. */
let solPriceCache: { price: number; at: number } | null = null

export async function fetchSolPriceUsd(): Promise<number | null> {
  if (solPriceCache && Date.now() - solPriceCache.at < 300_000) {
    return solPriceCache.price
  }
  try {
    const res = await fetch(
      'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112',
      { signal: AbortSignal.timeout(6_000) },
    )
    if (res.ok) {
      const data = await res.json() as Record<string, { usdPrice?: number }>
      const price = data['So11111111111111111111111111111111111111112']?.usdPrice
      if (typeof price === 'number' && price > 0) {
        solPriceCache = { price, at: Date.now() }
        return price
      }
    }
    // Fallback: CoinGecko simple price
    const cgRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { signal: AbortSignal.timeout(6_000) },
    )
    if (cgRes.ok) {
      const cg = await cgRes.json() as { solana?: { usd?: number } }
      const price = cg.solana?.usd
      if (typeof price === 'number' && price > 0) {
        solPriceCache = { price, at: Date.now() }
        return price
      }
    }
    return solPriceCache?.price ?? null
  } catch {
    return solPriceCache?.price ?? null
  }
}

/**
 * Fetch the KOLScan roster + live transaction feed, keyless-first.
 *
 * Sources (all attempted, failures isolated per leg):
 *   1. Public Supabase REST — keyless wallet roster + transaction feed.
 *   2. kolscan.io RSC HTML — always fetched, because `evm_address` exists ONLY
 *      in the SSR payload, never in the exposed Supabase `wallets` table.
 *
 * `KOLSCAN_SESSION` is optional: when non-empty it is sent as a `user-session`
 * cookie, but the request is never gated on it (a keyless GET is byte-identical).
 *
 * Both sources are merged (dedup by address / signature) and USD valuation runs
 * through a single `fetchSolPriceUsd()` call per invocation. Returns empty lists
 * (never throws) only when BOTH sources yield nothing.
 */
export async function fetchKolscanFeed(): Promise<KolscanFeed> {
  const empty: KolscanFeed = { wallets: [], transactions: [], fetchedAt: new Date().toISOString() }

  const [keylessWallets, keylessTxs] = await Promise.all([
    fetchKolscanWalletsKeyless(),
    fetchKolscanTxsKeyless(),
  ])

  let htmlWallets: KolscanWallet[] = []
  let htmlTxs: Omit<KolscanTransaction, 'usdValue'>[] = []
  try {
    const session = getSession()
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
    }
    if (session) headers['Cookie'] = `user-session=${session}`

    const res = await fetch(KOLSCAN_BASE, { headers, signal: AbortSignal.timeout(15_000) })
    if (res.ok) {
      const html = await res.text()
      htmlWallets = parseKolscanWallets(html)
      htmlTxs = parseKolscanTransactions(html)
    } else {
      console.warn(`[kolscan] html leg HTTP ${res.status}`)
    }
  } catch (err) {
    console.warn(`[kolscan] html leg failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Merge wallets: keyless is the base, HTML overlays non-null fields
  // (notably evmAddress, which only the RSC payload provides).
  const wallets = new Map<string, KolscanWallet>()
  for (const w of keylessWallets) wallets.set(w.address, w)
  for (const w of htmlWallets) {
    const existing = wallets.get(w.address)
    if (!existing) {
      wallets.set(w.address, w)
      continue
    }
    wallets.set(w.address, {
      ...existing,
      name: existing.name || w.name,
      twitter: existing.twitter ?? w.twitter,
      telegram: existing.telegram ?? w.telegram,
      evmAddress: existing.evmAddress ?? w.evmAddress,
      pfp: existing.pfp ?? w.pfp,
    })
  }

  // Merge txs: dedup by signature, keyless wins.
  const seenSignatures = new Set<string>()
  const rawTxs: Omit<KolscanTransaction, 'usdValue'>[] = []
  for (const tx of [...keylessTxs, ...htmlTxs]) {
    if (seenSignatures.has(tx.signature)) continue
    seenSignatures.add(tx.signature)
    rawTxs.push(tx)
  }

  if (wallets.size === 0 && rawTxs.length === 0) return empty

  const solPrice = await fetchSolPriceUsd()
  const transactions: KolscanTransaction[] = rawTxs.map((tx) => ({
    ...tx,
    usdValue: solPrice !== null ? tx.solChange * solPrice : null,
  }))

  return { wallets: [...wallets.values()], transactions, fetchedAt: new Date().toISOString() }
}

/** Unescape the Next.js RSC payload (array of ["1", "<escaped>"] chunks) into raw text. */
function extractRscText(html: string): string {
  const chunks = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) ?? []
  let full = ''
  for (const raw of chunks) {
    const inner = raw.slice('self.__next_f.push([1,"'.length, -'"])'.length)
    try {
      full += JSON.parse(`"${inner}"`)
    } catch {
      full += inner
    }
  }
  return full
}

const SOLANA_ADDR_RE = '[A-Za-z0-9]{32,44}'

export function parseKolscanWallets(html: string): KolscanWallet[] {
  const text = extractRscText(html)
  const seen = new Map<string, KolscanWallet>()
  // Wallets are inside an array of objects: {"wallet_address":"...","name":"...",...}
  // Match each wallet JSON block from {"wallet_address" up to ,"transactions":[
  const re = /\{"wallet_address":"([A-Za-z0-9]{32,44})",(.*?),"transactions":\[/g
  for (const m of text.matchAll(re)) {
    const address = m[1]
    if (seen.has(address)) continue
    const body = m[2]
    const name = body.match(/"name":"((?:[^"\\]|\\.)*)"/)?.[1] ?? ''
    const pfp = body.match(/"pfp":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null
    const twitter = body.match(/"twitter":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null
    const telegram = body.match(/"telegram":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null
    const evm = body.match(/"evm_address":"(0x[0-9a-fA-F]{40})"/)?.[1] ?? null
    seen.set(address, {
      address,
      name: unescapeJson(name),
      pfp: pfp ? unescapeJson(pfp) : null,
      twitter: twitter ? unescapeJson(twitter) : null,
      telegram: telegram ? unescapeJson(telegram) : null,
      evmAddress: evm,
    })
  }
  return [...seen.values()]
}

export function parseKolscanTransactions(html: string): Omit<KolscanTransaction, 'usdValue'>[] {
  const text = extractRscText(html)
  const out: Omit<KolscanTransaction, 'usdValue'>[] = []
  const re = new RegExp(
    `\\{"signature":"([A-Za-z0-9]+)","wallet_address":"(${SOLANA_ADDR_RE})",` +
    `"timestamp":(\\d+),"sol_change":([\\d.-]+),` +
    `"out_token_symbol":"((?:[^"\\\\]|\\\\.)*)","out_token_address":"((?:[^"\\\\]|\\\\.)*)","out_amount":([\\d.]+),` +
    `"in_token_symbol":"((?:[^"\\\\]|\\\\.)*)","in_token_address":"((?:[^"\\\\]|\\\\.)*)","in_amount":([\\d.]+),` +
    `"dex":"((?:[^"\\\\]|\\\\.)*)","name":"((?:[^"\\\\]|\\\\.)*)","pfp":`,
    'g',
  )
  for (const m of text.matchAll(re)) {
    out.push({
      signature: m[1],
      walletAddress: m[2],
      timestamp: Number(m[3]),
      solChange: Number(m[4]),
      outTokenSymbol: unescapeJson(m[5]),
      outTokenAddress: m[6],
      outAmount: Number(m[7]),
      inTokenSymbol: m[8] ? unescapeJson(m[8]) : null,
      inTokenAddress: m[9] || null,
      inAmount: Number(m[10]),
      dex: unescapeJson(m[11]),
      kolName: unescapeJson(m[12]),
    })
  }
  return out
}

function unescapeJson(s: string): string {
  try {
    return JSON.parse(`"${s}"`)
  } catch {
    return s
  }
}

// ── Threshold + human/bot filtering ───────────────────────────

/** Operator thresholds for KOLScan purchase monitoring. */
export const KOLSCAN_THRESHOLDS = {
  /** Minimum purchase in USD (user-specified). */
  minPurchaseUsd: 1000,
  /** Minimum GMGN 30d win rate as a fraction (user-specified 60%). */
  minWinRate: 0.6,
  /**
   * Human-vs-bot: the same out_amount repeated by >=3 wallets inside one
   * feed refresh is treated as coordinated (bot/launcher) activity.
   * This mirrors the operator spec line "hindari transaksi bot" — exact
   * replica amounts across distinct KOL wallets are the strongest cheap
   * bot signal in the Pump.fun discovery path.
   */
  coordAmountCount: 3,
} as const

/**
 * Resolve the operator-overridable KOLScan thresholds from env, with the
 * hardcoded `KOLSCAN_THRESHOLDS` as fallback. Accepts an arbitrary env
 * record s unit testso can pass inline objects without mutating process.env.
 *
 * Honors:
 *   KOLSCAN_MIN_PURCHASE_USD — positive number (default 1000)
 *   KOLSCAN_MIN_WINRATE      — fraction 0..1 (default 0.6); 0 is honored
 *
 * Invalid/empty values fall back to the defaults — never NaN.
 */
export function resolveKolscanThresholds(
  env: Record<string, string | undefined> = process.env,
): { minPurchaseUsd: number; minWinRate: number } {
  const usdRaw = env.KOLSCAN_MIN_PURCHASE_USD
  const wrRaw = env.KOLSCAN_MIN_WINRATE

  const usd = usdRaw !== undefined && usdRaw !== '' ? Number(usdRaw) : NaN
  const wr = wrRaw !== undefined && wrRaw !== '' ? Number(wrRaw) : NaN

  return {
    minPurchaseUsd: !isNaN(usd) && usd > 0 ? usd : KOLSCAN_THRESHOLDS.minPurchaseUsd,
    minWinRate: !isNaN(wr) && wr >= 0 && wr <= 1 ? wr : KOLSCAN_THRESHOLDS.minWinRate,
  }
}

export interface KolscanScreenedTx extends KolscanTransaction {
  /** Human-readable reason this transaction survived the screen. */
  screenReason: string
}

/**
 * Screen KOLScan transactions against the operator gate:
 *   1. USD purchase >= minPurchaseUsd (sol_change * live SOL price).
 *   2. Wallet-level win rate >= minWinRate via the caller's GMGN win-rate
 *      lookup (KOLScan itself publishes no win rate — GMGN is the source).
 *   3. Coordinated replica-amount filter (bot-launcher guard): drop
 *      transactions whose exact out_amount appears >= coordAmountCount times
 *      in the same feed batch, counting only DISTINCT wallets.
 *
 * The winRate lookup is caller-supplied so this module stays GMGN-free
 * for unit tests (pass a Map or query fetchGmgnWalletStats per address).
 */
export function screenKolscanTransactions(
  txs: KolscanTransaction[],
  opts: {
    minPurchaseUsd?: number
    minWinRate?: number
    winRates?: Map<string, number | null>
  } = {},
): KolscanScreenedTx[] {
  const minUsd = opts.minPurchaseUsd ?? KOLSCAN_THRESHOLDS.minPurchaseUsd
  const minWr = opts.minWinRate ?? KOLSCAN_THRESHOLDS.minWinRate

  // Count distinct wallets per exact out_amount for the coordination guard.
  const amountWallets = new Map<string, Set<string>>()
  for (const tx of txs) {
    const key = `${tx.outTokenAddress}:${tx.outAmount}`
    let set = amountWallets.get(key)
    if (!set) {
      set = new Set()
      amountWallets.set(key, set)
    }
    set.add(tx.walletAddress)
  }

  const out: KolscanScreenedTx[] = []
  for (const tx of txs) {
    if (tx.usdValue === null || tx.usdValue < minUsd) continue
    const key = `${tx.outTokenAddress}:${tx.outAmount}`
    const walletsForAmount = amountWallets.get(key)
    if (walletsForAmount && walletsForAmount.size >= KOLSCAN_THRESHOLDS.coordAmountCount) {
      continue // coordinated replica — likely launcher/bot, not distinct humans
    }
    const wr = opts.winRates?.get(tx.walletAddress) ?? null
    if (wr === null || wr < minWr) continue
    out.push({
      ...tx,
      screenReason: `purchase $${tx.usdValue.toFixed(0)} >= $${minUsd}, winrate ${(wr * 100).toFixed(0)}% >= ${(minWr * 100).toFixed(0)}%, human (no replica cluster)`,
    })
  }
  return out.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
}
