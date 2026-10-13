// ─────────────────────────────────────────────────────────────
// KOLScan — Solana KOL wallet monitor.
// Source: kolscan.io (Next.js app; wallet feed embedded in RSC payload).
//
// This module scrapes KOLScan's homepage RSC (React Server Component)
// payload to extract:
//   1. KOL wallet roster: 500+ verified KOL wallets with names, Twitter,
//      Telegram, and EVM addresses.
//   2. Live transaction feed: latest KOL buys with wallet address, SOL
//      amount spent, token symbol/address/amount, DEX, timestamp.
//
// Authentication: session cookie `user-session` (KOLSCAN_SESSION env var).
// The session cookie is required; without it the RSC payload returns
// a bare shell without the wallet feed.
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
 * Fetch the KOLScan homepage and parse the embedded RSC payload for
 * the KOL wallet roster and live transaction feed.
 *
 * Returns empty lists (never throws) when session is missing or the
 * site is unreachable — callers fall back to the GMGN/Sheet sources.
 */
export async function fetchKolscanFeed(): Promise<KolscanFeed> {
  const empty: KolscanFeed = { wallets: [], transactions: [], fetchedAt: new Date().toISOString() }
  const session = getSession()
  if (!session) return empty

  try {
    const res = await fetch(KOLSCAN_BASE, {
      headers: {
        'Cookie': `user-session=${session}`,
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return empty
    const html = await res.text()

    const wallets = parseKolscanWallets(html)
    const rawTxs = parseKolscanTransactions(html)
    if (wallets.length === 0 && rawTxs.length === 0) return empty

    const solPrice = await fetchSolPriceUsd()
    const transactions: KolscanTransaction[] = rawTxs.map((tx) => ({
      ...tx,
      usdValue: solPrice !== null ? tx.solChange * solPrice : null,
    }))

    return { wallets, transactions, fetchedAt: new Date().toISOString() }
  } catch {
    return empty
  }
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
