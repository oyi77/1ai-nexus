// ─────────────────────────────────────────────────────────────
// First-seen-whale detector — PURE, zero I/O.
//
// Fills the gap the accumulation-alert and confluence-cron cannot:
// those modules only fire on wallets that are ALREADY tracked and
// classified in SmartMoneyWallet.  A whale buying a new token for
// the first time — a wallet nobody has seen before — produces no
// alert anywhere.
//
// This detector takes buy legs (any chain) and a set of known
// wallet addresses (from Wallet + SmartMoneyWallet tables) and
// returns signals for buyers that are NOT in the known set and
// whose single-leg USD exceeds the threshold.
//
// Discipline:
//   - A buy leg without valid USD is SKIPPED, not treated as $0.
//   - A wallet in the known set is NEVER a first-seen signal —
//     even if it is unclassified, it has been seen before.
//   - Dedup: one signal per (wallet, contract), keeping the
//     largest USD leg.
//   - Threshold default $10k single-leg, configurable via env
//     FIRST_SEEN_WHALE_MIN_USD.
//
// Pure — zero I/O, no network, no DB.
// ─────────────────────────────────────────────────────────────

/** A single buy leg — chain-agnostic, compatible with NormalizedSwap. */
export interface BuyLeg {
  /** The wallet that made the buy. */
  wallet: string
  /** Token contract / mint address. */
  contract: string
  /** Blockchain id ('solana', 'ethereum', …). */
  chain: string
  /** Real USD value of the buy leg — trade-time, never estimated. */
  usd: number
  /** Trade timestamp (ms epoch); null when unknown. */
  timestamp: number | null
}

/** Default minimum single-leg USD for a first-seen signal. */
export const FIRST_SEEN_WHALE_DEFAULT_MIN_USD = 10_000

export interface FirstSeenWhaleOptions {
  /** Minimum USD per single buy leg. Default $10k. */
  minUsd?: number
}

/**
 * A first-seen-whale signal: a buy from a wallet that is NOT in the
 * known/tracked set, above the USD threshold.
 */
export interface FirstSeenSignal {
  wallet: string
  contract: string
  chain: string
  usd: number
  timestamp: number | null
  /** Provenance label for the Wallet table upsert. */
  source: 'first-seen-whale'
}

function isFiniteUsd(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * Detect first-seen-whale signals from buy legs.
 *
 * @param buyLegs      Buy legs from any source (wallet-refresh harvest,
 *                     whale-buy scanner, KOLScan feed, etc.)
 * @param knownWallets Set of wallet addresses already in the Wallet
 *                     or SmartMoneyWallet table.  A wallet in this set
 *                     is NOT first-seen, regardless of classification.
 * @param opts         Threshold options.
 * @returns            FirstSeenSignal[] sorted by USD descending.
 */
export function detectFirstSeenWhale(
  buyLegs: BuyLeg[],
  knownWallets: Set<string>,
  opts: FirstSeenWhaleOptions = {},
): FirstSeenSignal[] {
  const minUsd = opts.minUsd ?? FIRST_SEEN_WHALE_DEFAULT_MIN_USD

  // Dedup by (wallet, contract): keep the largest USD leg.
  const byKey = new Map<string, FirstSeenSignal>()

  for (const leg of buyLegs) {
    // NEVER fabricate: invalid USD = skip, not $0.
    if (!isFiniteUsd(leg.usd)) continue
    if (leg.usd < minUsd) continue
    if (!leg.wallet || !leg.contract || !leg.chain) continue

    // A known wallet is never first-seen — it has been seen before,
    // even if unclassified.
    if (knownWallets.has(leg.wallet)) continue

    const key = `${leg.wallet}|${leg.contract}`
    const existing = byKey.get(key)
    if (existing && existing.usd >= leg.usd) continue // keep larger

    byKey.set(key, {
      wallet: leg.wallet,
      contract: leg.contract,
      chain: leg.chain,
      usd: leg.usd,
      timestamp: leg.timestamp,
      source: 'first-seen-whale',
    })
  }

  return [...byKey.values()].sort((a, b) => b.usd - a.usd)
}

/**
 * Resolve the first-seen threshold from env.  Falls back to the
 * default ($10k) when unset or invalid.  Exported so the cron and
 * tests share one resolution path.
 */
export function firstSeenMinUsdFromEnv(): number {
  const raw = process.env.FIRST_SEEN_WHALE_MIN_USD
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FIRST_SEEN_WHALE_DEFAULT_MIN_USD
}

/**
 * Convert FirstSeenSignal[] into persistable Wallet upsert rows.
 * Each signal becomes a lead with labels ['first-seen-whale', 'whale-lead']
 * — the same provenance pattern as whale-harvester's toPersistWallet.
 */
export function toFirstSeenWalletRows(
  signals: FirstSeenSignal[],
): Array<{ address: string; chain: string; labels: string[] }> {
  // Dedup by address: a wallet buying multiple tokens is one lead.
  const byAddr = new Map<string, { address: string; chain: string; labels: string[] }>()
  for (const s of signals) {
    if (byAddr.has(s.wallet)) continue
    byAddr.set(s.wallet, {
      address: s.wallet,
      chain: s.chain,
      labels: ['first-seen-whale', 'whale-lead'],
    })
  }
  return [...byAddr.values()]
}
