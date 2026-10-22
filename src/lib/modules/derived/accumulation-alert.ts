// ─────────────────────────────────────────────────────────────
// Whale accumulation alert — pure builder, renderer, dedupe.
//
// Fires ONE verified event only when a classified whale/smart-money
// wallet makes a CONFIRMED BUY of >= minBuyUsd on a token whose verified
// market cap is < maxMarketCapUsd (Solana-first). The buy source is the
// wallet-buys artifact produced by foldWalletBuys — the canonical
// verified-buy classifier. That classifier already rejects partial legs,
// failed swaps, current-price-only legs and transfers, so this module
// never re-admits them. KOLScan-sourced buys arrive through the same
// artifact, and provenance is carried in the event, never invented.
//
// Discipline:
//   - a random wallet's buy is NOT a whale event — zero bullish-classified
//     buyers means zero events.
//   - buy value is the candidate's aggregate, not an invented per-buyer
//     split: the artifact does not carry per-buyer USD, so per-buyer lines
//     are rendered as non-numeric evidence instead of a fabricated amount.
//   - market cap comes only from a caller-supplied verified map; a null MC
//     stays null and is flagged as missing (the caller decides whether to
//     suppress delivery, the builder never fabricates a price).
//   - evidence = real discoveryEvidence (if present) + foldWalletBuys
//     provenance; a tx signature is never invented.
//
// Pure — zero I/O, no network, no DB.
// ─────────────────────────────────────────────────────────────

import type { WalletBuyCandidate } from './wallet-discovery'
import type { LadderPlan } from './ladder-planner'
import type { StrategyVerdict } from './strategy-evaluator'

/** Statuses that count as a whale/smart-money buyer (legacy gate, retained for callers). */
export const ACCUMULATION_BUYER_STATUSES = [
  'WHALE_AND_SMART_MONEY',
  'QUALIFIED_SMART_MONEY',
  'WHALE',
] as const

export type AccumulationBuyerStatus = (typeof ACCUMULATION_BUYER_STATUSES)[number]

/**
 * Buyer taxonomy for the accumulation alert (operator spec, 4 categories).
 *
 * Replaces the old single gate (buyer must be WHALE / QUALIFIED_SMART_MONEY /
 * WHALE_AND_SMART_MONEY) with a 4-way classification. A pure smart-money gate
 * silently dropped every large buy made by an unclassified or KOL wallet —
 * the operator wants to see those buys too, clearly labelled as to how much
 * track record stands behind them.
 *
 *   fresh_wallet     no SmartMoneyWallet row / status NULL|UNKNOWN, or the
 *                    wallet carries the FIRST_SEEN label -> lowest trust.
 *   kol              Wallet.labels contains 'kol' (case-insensitive, so
 *                    'kolscan'/'kol-monitor' match) OR the alias says KOL.
 *   other_coin_whale SmartMoneyWallet.status = WHALE (not smart money).
 *   smart_money      status in {QUALIFIED_SMART_MONEY, WHALE_AND_SMART_MONEY}.
 *
 * Categories are ORTHOGONAL: a wallet can be both KOL and whale. The builder
 * keeps ALL applicable tags on the buyer so the operator sees "whale + KOL",
 * never one tag silently replacing the other.
 */
export const BUYER_CATEGORIES = [
  'fresh_wallet',
  'kol',
  'other_coin_whale',
  'smart_money',
] as const

export type BuyerCategory = (typeof BUYER_CATEGORIES)[number]

/** Per-category trust tier (operator spec). */
export type BuyerTier = 'low' | 'medium' | 'high' | 'highest'

export const BUYER_CATEGORY_TIER: Record<BuyerCategory, BuyerTier> = {
  fresh_wallet: 'low',
  kol: 'medium',
  other_coin_whale: 'high',
  smart_money: 'highest',
}

/**
 * Per-category disclaimer, rendered next to the buyer line. smart_money is
 * the incumbent verified gate, so it carries no disclaimer; every other
 * category says plainly what it is NOT.
 */
export const BUYER_CATEGORY_DISCLAIMER: Record<BuyerCategory, string | null> = {
  fresh_wallet: 'fresh wallet - no track record',
  kol: 'KOL/influencer buy - not necessarily smart money',
  other_coin_whale: 'whale buyer - large position, cross-token',
  smart_money: null,
}

/** Human label for each category, for the rendered tag. */
export const BUYER_CATEGORY_LABEL: Record<BuyerCategory, string> = {
  fresh_wallet: 'Fresh wallet',
  kol: 'KOL',
  other_coin_whale: 'Whale',
  smart_money: 'Smart money',
}

/** Statuses that mean verified smart money (highest tier). */
export const SMART_MONEY_STATUSES = ['QUALIFIED_SMART_MONEY', 'WHALE_AND_SMART_MONEY'] as const

/** The label the whale pipeline writes for a never-classified wallet. */
export const FIRST_SEEN_LABEL = 'FIRST_SEEN'


export const ACCUMULATION_DEFAULTS = {
  /** Minimum aggregate verified buy USD for a candidate to be an event. */
  minBuyUsd: 1000,
  /**
   * LEGACY simple cap, kept for the renderer's still-unstructured path.
   * The three strategy gates now own MC filtering (see strategy-evaluator
   * baseBandByStrategy); this exists only so an event without a strategy
   * read still cannot multi-million-cap through.
   */
  maxMarketCapUsd: 10_000_000,
  /** Per-contract alert cooldown. */
  cooldownMs: 6 * 60 * 60 * 1000,
  /** Fold window used by the caller — documented here, not re-applied. */
  aggregationWindowMs: 60 * 60 * 1000,
} as const

export const SUPPORTED_CHAINS = ['solana'] as const

/**
 * Cross-token semantics for an `other_coin_whale` buyer (operator GAP-1).
 *
 *   cross_token  — the wallet holds >= $50k of a token OTHER than the alert
 *                  token (TokenHolding.usdValue on a different contract).
 *                  Highest confidence: "a whale known for coin A is now
 *                  buying coin B".
 *   same_token   — the wallet already holds the alert token itself; the buy
 *                  is accumulation of an existing position, not migration.
 *   unknown      — no usable TokenHolding data for this wallet; the tag
 *                  falls back to the wallet-global (status-only) meaning it
 *                  has always had.
 */
export type CrossTokenContext = 'cross_token' | 'same_token' | 'unknown'

/** Minimum TokenHolding.usdValue for a holding to count as "large". */
export const CROSS_TOKEN_MIN_USD = 50_000

export interface AccumulationBuyer {
  address: string
  status: string
  /** Status label is authoritative; fallback text is separate. */
  classification: string
  /** Every taxonomy tag that applies (orthogonal — e.g. 'kol'+'other_coin_whale'). */
  categories: BuyerCategory[]
  /** Highest-trust tag, used for the event-level tier and tag ordering. */
  primaryCategory: BuyerCategory
  /** Trust tier of primaryCategory. */
  tier: BuyerTier
  /** Per-category disclaimers for the tags that carry one (smart_money: none). */
  disclaimers: string[]
  /** Per-buyer USD is NOT in the artifact; kept null rather than invented. */
  buyValueUsd: number | null
  stale: boolean
  alias: string | null
  /** Raw Wallet.labels, carried for provenance/rendering. */
  labels: string[]
  winRate?: number | null
  pnl?: number | null
  /**
   * Cross-token refinement for this buyer (present only when the buyer
   * carries the other_coin_whale tag). 'unknown' = fallback classification.
   */
  crossTokenContext?: CrossTokenContext
  /** Largest holding on a DIFFERENT contract (USD), when computed. */
  crossTokenHoldingUsd?: number | null
}

export interface AccumulationToken {
  chain: string
  contract: string
  symbol: string | null
  marketCapUsd: number | null
  liquidityUsd: number | null
}

export interface AccumulationEvent {
  token: AccumulationToken
  buyers: AccumulationBuyer[]
  /** Every category present among the buyers (union, tier-ordered). */
  categories: BuyerCategory[]
  /** Highest-trust category present — drives the alert header emoji. */
  primaryCategory: BuyerCategory
  /** Trust tier of primaryCategory. */
  tier: BuyerTier
  /** Unique per-category disclaimers (smart_money carries none). */
  disclaimers: string[]
  totalBuyUsd: number
  windowStartAt: string
  windowEndAt: string
  evidence: string[]
  risks: string[]
  missing: string[]
  /**
   * Which operator strategy fired for this token (null = none did).
   * When null the event is suppressed by the strategy gate or rendered
   * as a raw accumulation note with NO entry claim.
   */
  strategy?: StrategyVerdict | null
  /** Ladder plan for the fired strategy, when sizing input exists. */
  ladder?: LadderPlan | null
  /** Structure evidence lines (base, higher low, breakout, retest). */
  structure?: string[]
  /**
   * Telegram call-group confluence line ("call groups (3): A, B, C · score 8.1").
   * Absent/empty means the feed had nothing — the renderer then prints no
   * confluence block rather than claiming "0 groups called it".
   */
  callGroups?: string | null
}

export interface AccumulationOptions {
  minBuyUsd: number
  maxMarketCapUsd: number
  cooldownMs: number
  aggregationWindowMs: number
}

/** Caller-supplied wallet facts for one buyer address. */
export interface BuyerFacts {
  /** SmartMoneyWallet.status, or null when the wallet was never classified. */
  status: string | null
  /** Wallet.alias (operator watch-list name). */
  alias: string | null
  /** Wallet.labels — carries koi signals ('kolscan', 'kol-monitor', 'FIRST_SEEN'). */
  labels: string[]
  winRate?: number | null
  pnl?: number | null
  /**
   * The contract address of the token that triggered this alert, lowercased
   * for EVM, preserved as-is for Solana base58. Optional — callers that do
   * not query TokenHolding leave this and `walletHoldings` undefined, and
   * the cross-token refinement falls back to wallet-global (current behavior).
   */
  alertTokenContract?: string
  /**
   * Wallet's known token holdings from the TokenHolding table (tokenAddress +
   * usdValue). Used to distinguish a true cross-token whale (large holding on
   * a DIFFERENT contract) from same-token accumulation. Undefined = no
   * holding data queried → fallback to status-only classification.
   */
  walletHoldings?: Array<{ tokenAddress: string; usdValue: number }>
}

export interface AccumulationSourceInput {
  candidates: WalletBuyCandidate[]
  /** Buyer facts by address. Caller builds it from Wallet + SmartMoneyWallet. */
  buyerStatus: Map<string, BuyerFacts>
  /** Verified market data by contract. MC null = unverified (flagged). */
  market?: Map<string, { marketCapUsd: number | null; liquidityUsd: number | null; symbol: string | null }>
  opts?: Partial<AccumulationOptions>
}

function isFiniteUsd(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function toIso(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date(0).toISOString()
}

function evidenceLines(c: WalletBuyCandidate): string[] {
  const fromEvidence = (c.discoveryEvidence ?? []).map((e) => {
    const note = e.note ? ` — ${e.note}` : ''
    return `[${e.provider}/${e.category}] ${new Date(e.discoveredAt).toISOString()}${note}`
  })
  const provenance = `foldWalletBuys: $${c.buyVolumeUsd.toFixed(2)} across ${c.buyCount} verified buy leg(s) by ${c.buyers.length} tracked wallet(s)`
  return fromEvidence.length > 0 ? [...fromEvidence, provenance] : [provenance]
}

const BUYER_CLASSIFICATION: Record<string, string> = {
  WHALE_AND_SMART_MONEY: 'Whale + Smart Money',
  QUALIFIED_SMART_MONEY: 'Qualified Smart Money',
  WHALE: 'Whale',
  TRACER_PNL: 'Profitable holder on this token (no track record)',
}

/**
 * Escape Telegram HTML control characters in dynamic text. Same discipline
 * as meme-sniper's escapeHtml — keep the renderer self-contained/pure.
 */
export function escapeHtml(s: string | null | undefined): string {
  if (typeof s !== 'string') return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Contract equality across chains. EVM 0x addresses are case-insensitive;
 * Solana base58 mints are CASE-SENSITIVE (same rule as gmgn's
 * mapGmgnRowToToken / unified-candidate.ts). Defensive: also treat two
 * strings as equal when they differ only by case AND both look like 0x hex,
 * so a caller that lowercased an EVM contract still compares correctly.
 */
function contractsEqual(a: string, b: string): boolean {
  if (a === b) return true
  const isEvm = (s: string) => s.length === 42 && s.startsWith('0x')
  if (isEvm(a) && isEvm(b)) return a.toLowerCase() === b.toLowerCase()
  return false
}

/**
 * Resolve the cross-token context for a whale buyer (operator GAP-1). Pure.
 *
 *   cross_token — the wallet holds >= CROSS_TOKEN_MIN_USD on a contract
 *                 OTHER than the alert token: a whale known for coin A is
 *                 now buying coin B.
 *   same_token  — the wallet's large holding IS the alert token: the buy is
 *                 accumulation of an existing position, not migration.
 *   unknown     — no usable TokenHolding data (none queried, no rows, or
 *                 every holding below the threshold) -> the caller keeps the
 *                 wallet-global (status-only) meaning.
 *
 * Cross-token wins over same-token when both apply: migration is the
 * stronger signal, and the wallet holds a different large position too.
 */
export function resolveCrossTokenContext(facts: BuyerFacts): {
  context: CrossTokenContext
  holdingUsd: number | null
} {
  const holdings = facts.walletHoldings
  if (!holdings || holdings.length === 0) return { context: 'unknown', holdingUsd: null }

  const alertContract = (facts.alertTokenContract ?? '').trim()
  let maxCrossTokenUsd: number | null = null
  let maxSameTokenUsd: number | null = null

  for (const h of holdings) {
    const addr = typeof h?.tokenAddress === 'string' ? h.tokenAddress.trim() : ''
    if (addr === '') continue
    if (!Number.isFinite(h.usdValue) || h.usdValue <= 0) continue // never invent USD
    const isAlertToken = alertContract !== '' && contractsEqual(addr, alertContract)
    if (isAlertToken) {
      if (maxSameTokenUsd === null || h.usdValue > maxSameTokenUsd) maxSameTokenUsd = h.usdValue
    } else if (maxCrossTokenUsd === null || h.usdValue > maxCrossTokenUsd) {
      maxCrossTokenUsd = h.usdValue
    }
  }

  if (maxCrossTokenUsd !== null && maxCrossTokenUsd >= CROSS_TOKEN_MIN_USD) {
    return { context: 'cross_token', holdingUsd: maxCrossTokenUsd }
  }
  if (maxSameTokenUsd !== null && maxSameTokenUsd >= CROSS_TOKEN_MIN_USD) {
    return { context: 'same_token', holdingUsd: maxSameTokenUsd }
  }
  return { context: 'unknown', holdingUsd: null }
}

/** classifyBuyer result plus the cross-token refinement (GAP-1). */
export interface BuyerClassification {
  categories: BuyerCategory[]
  /**
   * Present only when the buyer carries `other_coin_whale`. 'unknown' means
   * the fallback (wallet-global) meaning applies.
   */
  crossTokenContext?: CrossTokenContext
  /** Largest qualifying holding (USD) used to decide the context; null = none. */
  crossTokenHoldingUsd?: number | null
}

/**
 * classifyBuyer plus the cross-token refinement. Kept SEPARATE from
 * classifyBuyer so the long-standing `classifyBuyer(facts) => BuyerCategory[]`
 * contract (and its tests) stays byte-identical.
 *
 * The cross-token check runs ONLY for the other_coin_whale tag — a
 * smart-money or KOL buyer keeps its existing classification with no
 * holding lookup.
 */
export function resolveBuyerContext(facts: BuyerFacts): BuyerClassification {
  const categories = classifyBuyer(facts)
  if (!categories.includes('other_coin_whale')) return { categories }
  const { context, holdingUsd } = resolveCrossTokenContext(facts)
  return { categories, crossTokenContext: context, crossTokenHoldingUsd: holdingUsd }
}

/**
 * Per-buyer disclaimer for the other_coin_whale tag, context-aware.
 * cross_token / same_token are distinct, actionable statements; 'unknown'
 * keeps the original wallet-global wording verbatim.
 */
function otherCoinWhaleDisclaimer(
  context: CrossTokenContext | undefined,
  holdingUsd: number | null | undefined,
): string {
  if (context === 'cross_token') {
    const amount = holdingUsd !== null && holdingUsd !== undefined && Number.isFinite(holdingUsd)
      ? formatCompactUsd(holdingUsd)
      : 'a large position'
    return `whale buyer - cross-token migration (holds ${amount} on other tokens)`
  }
  if (context === 'same_token') {
    return 'whale buyer - accumulating existing position'
  }
  return BUYER_CATEGORY_DISCLAIMER.other_coin_whale ?? 'whale buyer - large position, cross-token'
}

/**
 * Classify a buyer into ALL applicable taxonomy tags (orthogonal).
 *
 * The tags are NOT mutually exclusive — a KOL that is also a wallet-level
 * whale carries both tags. Tags are returned in descending trust order so
 * the first element is the primaryCategory:
 *   smart_money > other_coin_whale > kol > fresh_wallet
 *
 * 'fresh_wallet' is the catch-all: it applies when the wallet has no usable
 * track record (no SMW row, UNKNOWN status, or the FIRST_SEEN label). A
 * wallet with DISQUALIFIED status is NOT a fresh_wallet — it has a negative
 * record, so it only emits when it ALSO carries kol/whale/smart_money; a
 * pure-DISQUALIFIED wallet emits nothing (the gate below skips it).
 */
export function classifyBuyer(facts: BuyerFacts): BuyerCategory[] {
  const tags: BuyerCategory[] = []

  const status = facts.status ?? null
  const statusUpper = typeof status === 'string' ? status.toUpperCase() : ''
  const labels = facts.labels ?? []
  const hasFirstSeen = labels.some((l) => l === FIRST_SEEN_LABEL)

  // 1. smart_money — verified qualified smart money (highest trust).
  if ((SMART_MONEY_STATUSES as readonly string[]).includes(statusUpper)) {
    tags.push('smart_money')
  }

  // 2. other_coin_whale — wallet-level whale (not smart money). WHALE_AND_SMART_MONEY
  //    already tagged smart_money above; a pure WHALE status lands here.
  if (statusUpper === 'WHALE') {
    tags.push('other_coin_whale')
  }

  // 3. kol — orthogonal: a KOL/influencer label on the Wallet (kolscan,
  //    kol-monitor, etc.) OR the alias that says KOL, OR the GMGN
  //    'smart_degen' tag (high-winrate trader proxy — KOLScan is inert,
  //    so smart_degen is the live source for "known profitable trader").
  //    Checked regardless of SMW status because the operator wants KOL
  //    as a separate signal.
  const aliasLower = (facts.alias ?? '').toLowerCase()
  const isKol =
    labels.some((l) => l.toLowerCase().includes('kol')) ||
    labels.some((l) => l.toLowerCase() === 'smart_degen') ||
    aliasLower.includes('kol')
  if (isKol) {
    tags.push('kol')
  }

  // 4. fresh_wallet — no usable track record. NULL/UNKNOWN status, or no
  //    SMW row at all (status null), or the FIRST_SEEN label. DISQUALIFIED
  //    is a *negative* record, not a fresh wallet, so it is excluded here.
  const isFresh =
    status === null ||
    statusUpper === 'UNKNOWN' ||
    statusUpper === '' ||
    hasFirstSeen
  if (isFresh) {
    tags.push('fresh_wallet')
  }

  // Descending trust order so tags[0] is the primaryCategory.
  const ORDER: Record<BuyerCategory, number> = {
    smart_money: 0,
    other_coin_whale: 1,
    kol: 2,
    fresh_wallet: 3,
  }
  tags.sort((a, b) => ORDER[a] - ORDER[b])
  return tags
}

/**
 * Build accumulation events under the 4-category buyer taxonomy.
 * A candidate becomes an event only when:
 *   - chain is in SUPPORTED_CHAINS
 *   - buyVolumeUsd >= minBuyUsd
 *   - at least one buyer carries a taxonomy tag after the fresh-wallet
 *     volume floor (see below)
 *   - verified market cap (when supplied) is < maxMarketCapUsd
 * A null market cap never excludes the event; it is reported in `missing`
 * so the caller can apply its own suppression policy. This module never
 * fabricates a market cap, a per-buyer amount, or a tx signature.
 *
 * Fresh-wallet discipline (operator spec): a `fresh_wallet` buyer only emits
 * when the CANDIDATE's aggregate buy volume is >= minBuyUsd (the same floor
 * every other category passes) — large fresh buys are interesting, small
 * ones are noise. kol / other_coin_whale / smart_money emit with no extra
 * floor. A buyer with no tags at all (e.g. pure-DISQUALIFIED with no KOL or
 * whale tag) never emits.
 */
export function buildAccumulationEvents(input: AccumulationSourceInput): AccumulationEvent[] {
  const opts = { ...ACCUMULATION_DEFAULTS, ...(input.opts ?? {}) }
  const out: AccumulationEvent[] = []

  for (const c of input.candidates) {
    if (!(SUPPORTED_CHAINS as readonly string[]).includes(c.chain)) continue
    if (!isFiniteUsd(c.buyVolumeUsd) || c.buyVolumeUsd < opts.minBuyUsd) continue

    const buyers: AccumulationBuyer[] = []
    const missing: string[] = []
    for (const address of c.buyers) {
      // A missing map entry = no SMW row = never-classified wallet. Carry the
      // alert contract so a WHALE buyer's cross-token context can be resolved
      // against its TokenHolding rows.
      const base = input.buyerStatus.get(address)
      const facts: BuyerFacts = base
        ? { ...base, alertTokenContract: base.alertTokenContract ?? c.contract }
        : { status: null, alias: null, labels: [], alertTokenContract: c.contract }
      const { categories: tags, crossTokenContext, crossTokenHoldingUsd } = resolveBuyerContext(facts)
      if (tags.length === 0) continue
      const primary = tags[0]
      // Fresh wallets have no track record: require an aggregate buy at
      // least 2x the candidate floor before they are interesting. Verified
      // categories emit with no extra floor.
      if (primary === 'fresh_wallet' && c.buyVolumeUsd < opts.minBuyUsd * 2) continue
      const disclaimers = tags
        .map((t) =>
          t === 'other_coin_whale'
            ? otherCoinWhaleDisclaimer(crossTokenContext, crossTokenHoldingUsd)
            : BUYER_CATEGORY_DISCLAIMER[t],
        )
        .filter((d): d is string => d !== null)
      const status = facts.status ?? 'UNCLASSIFIED'
      buyers.push({
        address,
        status,
        classification: BUYER_CLASSIFICATION[status] ?? BUYER_CATEGORY_LABEL[primary],
        categories: tags,
        primaryCategory: primary,
        tier: BUYER_CATEGORY_TIER[primary],
        disclaimers,
        buyValueUsd: null,
        stale: false,
        alias: facts.alias,
        labels: facts.labels ?? [],
        winRate: facts.winRate ?? null,
        pnl: facts.pnl ?? null,
        crossTokenContext,
        crossTokenHoldingUsd: crossTokenHoldingUsd ?? null,
      })
    }
    if (buyers.length === 0) continue // no tagged buyer, no event

    const market = input.market?.get(c.contract) ?? null
    const marketCapUsd = market?.marketCapUsd ?? null
    const liquidityUsd = market?.liquidityUsd ?? null
    const symbol = market?.symbol ?? null

    if (marketCapUsd === null) {
      missing.push('market cap unverified')
    } else if (!isFiniteUsd(marketCapUsd) || marketCapUsd >= opts.maxMarketCapUsd) {
      continue // spec: MC < $1M — above threshold is excluded
    }

    const risks: string[] = []
    if (liquidityUsd === null) risks.push('liquidity unverified')
    if (c.buyCount < c.buyers.length) risks.push('buy count below buyer count')

    // Event-level tags: union of buyer tags, tier-ordered; primary is the
    // highest-trust tag present; disclaimers are unique across buyers.
    const tagSet = new Set<BuyerCategory>()
    for (const b of buyers) for (const t of b.categories) tagSet.add(t)
    const TIER_ORDER: Record<BuyerCategory, number> = {
      smart_money: 0,
      other_coin_whale: 1,
      kol: 2,
      fresh_wallet: 3,
    }
    const categories = [...tagSet].sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b])
    const primaryCategory = categories[0]
    const disclaimers = [...new Set(buyers.flatMap((b) => b.disclaimers))]

    out.push({
      token: { chain: c.chain, contract: c.contract, symbol, marketCapUsd, liquidityUsd },
      buyers,
      categories,
      primaryCategory,
      tier: BUYER_CATEGORY_TIER[primaryCategory],
      disclaimers,
      totalBuyUsd: c.buyVolumeUsd,
      windowStartAt: toIso(c.firstBuyAt),
      windowEndAt: toIso(c.lastBuyAt),
      evidence: evidenceLines(c),
      risks,
      missing,
    })
  }

  return out.sort((a, b) => b.totalBuyUsd - a.totalBuyUsd)
}

function formatCompactUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '<i>unverified</i>'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) {
    const k = n / 1e3
    return (k >= 100 && Number.isInteger(k) ? `$${k}K` : `$${k.toFixed(1)}K`).replace('.0K', 'K')
  }
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function formatWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const diffMin = Math.round((end - start) / 60000)
    if (diffMin < 60) return `${Math.max(1, diffMin)}m`
    const diffH = (diffMin / 60).toFixed(1).replace(/\.0$/, '')
    return `${diffH}h`
  }
  return '1h'
}

/**
 * Render the operator-facing HTML alert. Keeps the exact title `WHALE
 * ACCUMULATION DETECTED` so existing suppressions/pinned assertions keep
 * working; the buyer taxonomy is surfaced through a category banner line,
 * per-buyer tags, and per-buyer disclaimer lines. Includes token/mint, MC +
 * liquidity + total buy, per-buyer status/classification, evidence, risks,
 * missing, and an explicit footer. Under 4096 chars: buyer lines are
 * truncated first, then the whole text is sliced for Telegram.
 */
export function renderAccumulationAlert(event: AccumulationEvent): string {
  /** MC formatter for strategy/structure lines (millions, 2dp). */
  const mfmt = (v: number): string => (v / 1e6).toFixed(2) + 'M'
  const t = event.token
  const rawSymbol = t.symbol && t.symbol.trim() !== '' ? t.symbol.trim().toUpperCase() : '?'
  const symbol = rawSymbol.startsWith('$') ? rawSymbol : (rawSymbol === '?' ? '<i>Unknown</i>' : `$${escapeHtml(rawSymbol)}`)
  const chainName = t.chain ? escapeHtml(t.chain.charAt(0).toUpperCase() + t.chain.slice(1)) : 'Solana'

  const mc = formatCompactUsd(t.marketCapUsd)
  const liquidity = formatCompactUsd(t.liquidityUsd)
  const total = `$${Math.round(event.totalBuyUsd).toLocaleString('en-US')}`
  const windowStr = formatWindow(event.windowStartAt, event.windowEndAt)

  // Event taxonomy banner: every category present (tier-ordered), plus the
  // disclaimers of the tags that carry one. Back-compat classes/readers
  // that construct events by hand may omit these fields — default to whale.
  const categories: BuyerCategory[] = event.categories ?? ['other_coin_whale']
  const disclaimers: string[] = event.disclaimers ?? []
  const tagLabels = categories.map((cat) => BUYER_CATEGORY_LABEL[cat]).join(' + ')

  const lines: string[] = [
    `🐋 <b>WHALE ACCUMULATION DETECTED</b>`,
    `🏷 <b>Signal:</b> ${escapeHtml(tagLabels)}`,
  ]
  for (const d of disclaimers) {
    lines.push(`⚠️ <i>${escapeHtml(d)}</i>`)
  }
  lines.push(
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🪙 <b>Token:</b> ${symbol}`,
    `📋 <b>CA:</b> <code>${escapeHtml(t.contract)}</code> <i>(tap to copy)</i>`,
    `⛓ <b>Chain:</b> ${chainName}`,
    ``,
    `💰 <b>Whale Buy Inflow:</b> <b>${total}</b>`,
    `📊 <b>Market Cap:</b> ${mc}  |  💧 <b>Liquidity:</b> ${liquidity}`,
    `⏱ <b>Window:</b> ${windowStr}`,
    ``,
    `👤 <b>Accumulating Buyers (${event.buyers.length}):</b>`,
  )

  for (const b of event.buyers) {
    const name = b.alias && b.alias.trim() !== ''
      ? escapeHtml(b.alias.trim())
      : `${escapeHtml(b.address.slice(0, 6))}…${escapeHtml(b.address.slice(-4))}`

    // Back-compat: hand-built buyers in older callers lack tags — surface
    // their classification as-is.
    const tags: BuyerCategory[] = b.categories ?? []
    const buyerTagLabels = tags.map((cat) => BUYER_CATEGORY_LABEL[cat]).join(' + ')

    const badgeParts: string[] = []
    if (buyerTagLabels !== '') badgeParts.push(escapeHtml(buyerTagLabels))
    const statusLabel = b.status || b.classification || 'WHALE'
    badgeParts.push(escapeHtml(statusLabel))

    // Win rate is always shown: a measured fraction becomes "WR NN%", a
    // genuinely unmeasured buyer renders "n/a" (never a fabricated 0%).
    badgeParts.push(
      b.winRate !== undefined && b.winRate !== null
        ? `WR ${(b.winRate * 100).toFixed(0)}%`
        : 'WR n/a',
    )
    if (b.pnl !== undefined && b.pnl !== null) {
      const rounded = Math.round(b.pnl * 100)
      badgeParts.push(`PnL ${rounded >= 0 ? '+' : ''}${rounded}%`)
    }
    if (
      b.classification &&
      b.classification.toLowerCase().replace(/[\s_]+/g, '') !==
        statusLabel.toLowerCase().replace(/[\s_]+/g, '')
    ) {
      badgeParts.push(escapeHtml(b.classification))
    }
    if (b.stale) badgeParts.push('stale')

    const badge = `[${badgeParts.join(' · ')}]`

    let boughtAmount: string
    if (b.buyValueUsd !== null && Number.isFinite(b.buyValueUsd)) {
      boughtAmount = `$${Math.round(b.buyValueUsd).toLocaleString('en-US')}`
    } else if (event.buyers.length === 1) {
      boughtAmount = total
    } else {
      boughtAmount = `Part of ${total}`
    }

    lines.push(`• <b>${name}</b> ${badge}`)
    lines.push(`  └ Bought: <b>${boughtAmount}</b> · Wallet: <code>${escapeHtml(b.address)}</code>`)
    const buyerDisclaimers: string[] = b.disclaimers ?? []
    for (const d of buyerDisclaimers) {
      lines.push(`  └ ⚠️ <i>${escapeHtml(d)}</i>`)
    }
  }

  // Evidence (concise, compact)
  if (event.evidence.length > 0) {
    lines.push(``, `🔍 <b>Evidence:</b>`)
    for (const e of event.evidence.slice(0, 3)) {
      lines.push(`• <i>${escapeHtml(e)}</i>`)
    }
  }

  // Strategy verdict — the operator's playbook, evaluated by code.
  if (event.strategy) {
    const v = event.strategy
    const label = { second_wave: 'Second Wave', level_flip: 'Level Flip', whale_comeback: 'Whale Comeback' }[v.strategy]
    lines.push(``, `🎯 <b>Strategy: ${label}</b> — fires (confidence ${v.confidence}/100)`)
    if (v.entryUsd !== null && v.stopUsd !== null) {
      lines.push(
        `• Entry: <b>$${mfmt(v.entryUsd)}</b> · SL: <b>$${mfmt(v.stopUsd)}</b>` +
          (v.targetUsd !== null ? ` · TP: <b>$${mfmt(v.targetUsd)}</b>` : '') +
          (v.rr !== null ? ` · RR <b>1:${v.rr.toFixed(2)}</b>` : ''),
      )
    }
  }
  if (event.structure && event.structure.length > 0) {
    lines.push(``, `📐 <b>Structure (MC chart):</b>`)
    for (const s of event.structure.slice(0, 6)) {
      lines.push(`• <i>${escapeHtml(s)}</i>`)
    }
  }
  if (event.callGroups) {
    lines.push(``, `📣 <b>Call groups:</b> <i>${escapeHtml(event.callGroups)}</i>`)
  }
  if (event.ladder?.valid) {
    const l = event.ladder
    lines.push(
      ``,
      `🪜 <b>Ladder:</b> ${l.tranches.map((t) => `$${mfmt(t.atMcUsd)} (${t.reason} ${Math.round(t.weight * 100)}%)`).join('  →  ')}`,
      `• One SL <b>$${mfmt(l.stopUsd)}</b> · risk $${l.riskUsd.toFixed(0)} · loss@SL $${l.lossAtStopUsd.toFixed(2)}`,
    )
  } else if (event.ladder && !event.ladder.valid && event.ladder.problem) {
    lines.push(``, `🪜 <i>Ladder not buildable: ${escapeHtml(event.ladder.problem)}</i>`)
  }
  if (!event.strategy) {
    lines.push(``, `🎯 <i>No strategy fired (structure/gates not met) — monitoring only.</i>`)
  }

  // Risks & Missing flags
  const riskLines = [
    ...event.risks.map((r) => `• <i>${escapeHtml(r)}</i>`),
    ...event.missing.map((m) => `• <i>Missing ${escapeHtml(m)}</i>`),
  ]
  if (riskLines.length > 0) {
    lines.push(``, `⚠️ <b>Flags & Warnings:</b>`)
    lines.push(...riskLines)
  }

  lines.push(
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚠️ <i>Screening alert only — DYOR & manage risk</i>`,
  )

  return truncateLines(lines, 4090)
}

/** Keep the message under Telegram's 4096 cap; drop buyer lines first. */
function truncateLines(lines: string[], cap: number): string {
  let joined = lines.join('\n')
  if (joined.length <= cap) return joined

  const footerIdx = lines.findIndex((l) => l.includes('Screening alert only'))
  if (footerIdx > 0) {
    const headerLines = lines.slice(0, footerIdx)
    const footerLines = lines.slice(footerIdx)
    while (headerLines.length > 8 && (headerLines.join('\n') + '\n' + footerLines.join('\n')).length > cap - 50) {
      headerLines.pop()
    }
    headerLines.push('• <i>…additional buyers truncated</i>')
    joined = [...headerLines, ...footerLines].join('\n')
    if (joined.length <= cap) return joined
  }

  return joined.slice(0, cap - 1) + '…'
}

/**
 * Pure dedupe: send only when the contract was never sent, or the last
 * send is at least cooldownMs ago. State is `Record<contract, lastSentAtMs>`.
 */
export function shouldSend(
  event: Pick<AccumulationEvent, 'token'>,
  state: Record<string, number>,
  now: number,
  cooldownMs: number = ACCUMULATION_DEFAULTS.cooldownMs,
): boolean {
  const contract = event.token.contract
  const last = state[contract]
  if (typeof last !== 'number' || !Number.isFinite(last)) return true
  return now - last >= cooldownMs
}

/**
 * Keep every sendable event unique by contract across a single run — the
 * builder never emits two events for one contract, but the helper makes
 * the invariant explicit for callers that merge multiple sources.
 */
export function dedupeEventsByContract(events: AccumulationEvent[]): AccumulationEvent[] {
  const seen = new Set<string>()
  const out: AccumulationEvent[] = []
  for (const ev of events) {
    const key = ev.token.contract
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ev)
  }
  return out
}
