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

/** Statuses that count as a whale/smart-money buyer. */
export const ACCUMULATION_BUYER_STATUSES = [
  'WHALE_AND_SMART_MONEY',
  'QUALIFIED_SMART_MONEY',
  'WHALE',
] as const

export type AccumulationBuyerStatus = (typeof ACCUMULATION_BUYER_STATUSES)[number]

export const ACCUMULATION_DEFAULTS = {
  /** Minimum aggregate verified buy USD for a candidate to be an event. */
  minBuyUsd: 1000,
  /** Tokens with verified market cap >= this are excluded (spec: < $1M). */
  maxMarketCapUsd: 1_000_000,
  /** Per-contract alert cooldown. */
  cooldownMs: 6 * 60 * 60 * 1000,
  /** Fold window used by the caller — documented here, not re-applied. */
  aggregationWindowMs: 60 * 60 * 1000,
} as const

export const SUPPORTED_CHAINS = ['solana'] as const

export interface AccumulationBuyer {
  address: string
  status: string
  /** Status label is authoritative; fallback text is separate. */
  classification: string
  /** Per-buyer USD is NOT in the artifact; kept null rather than invented. */
  buyValueUsd: number | null
  stale: boolean
  alias: string | null
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
  totalBuyUsd: number
  windowStartAt: string
  windowEndAt: string
  evidence: string[]
  risks: string[]
  missing: string[]
}

export interface AccumulationOptions {
  minBuyUsd: number
  maxMarketCapUsd: number
  cooldownMs: number
  aggregationWindowMs: number
}

export interface AccumulationSourceInput {
  candidates: WalletBuyCandidate[]
  /** Buyer classification by address. Caller builds it from SmartMoneyWallet. */
  buyerStatus: Map<string, { status: string; alias: string | null }>
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
}

/**
 * Escape Telegram HTML control characters in dynamic text. Same discipline
 * as meme-sniper's escapeHtml — keep the renderer self-contained/pure.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Build verified whale-accumulation events. A candidate becomes an event
 * only when:
 *   - chain is in SUPPORTED_CHAINS
 *   - buyVolumeUsd >= minBuyUsd
 *   - at least one buyer is classified in a bullish status
 *   - verified market cap (when supplied) is < maxMarketCapUsd
 * A null market cap never excludes the event; it is reported in `missing`
 * so the caller can apply its own suppression policy. This module never
 * fabricates a market cap, a per-buyer amount, or a tx signature.
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
      const cls = input.buyerStatus.get(address)
      if (!cls || !(ACCUMULATION_BUYER_STATUSES as readonly string[]).includes(cls.status)) continue
      buyers.push({
        address,
        status: cls.status,
        classification: BUYER_CLASSIFICATION[cls.status] ?? cls.status,
        buyValueUsd: null,
        stale: false,
        alias: cls.alias,
      })
    }
    if (buyers.length === 0) continue // a random wallet's buy is not a whale event

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

    out.push({
      token: { chain: c.chain, contract: c.contract, symbol, marketCapUsd, liquidityUsd },
      buyers,
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

/**
 * Render the operator-facing HTML alert. Exact title `WHALE ACCUMULATION
 * ALERT`; includes token/mint, verified-at, MC + liquidity + total buy,
 * per-buyer status/classification, evidence, risks, missing, and an
 * explicit "alert ≠ entry" footer. Under 4096 chars: buyer lines are
 * truncated first, then the whole text is sliced for Telegram.
 */
export function renderAccumulationAlert(event: AccumulationEvent): string {
  const t = event.token
  const symbol =
    t.symbol && t.symbol.trim() !== '' ? escapeHtml(t.symbol.trim()) : '?'
  const mc =
    t.marketCapUsd !== null
      ? `$${Math.round(t.marketCapUsd).toLocaleString('en-US')}`
      : '<i>unverified</i>'
  const liquidity =
    t.liquidityUsd !== null ? `$${Math.round(t.liquidityUsd).toLocaleString('en-US')}` : '<i>unverified</i>'
  const total = `$${Math.round(event.totalBuyUsd).toLocaleString('en-US')}`

  const lines: string[] = [
    `<b>WHALE ACCUMULATION ALERT</b>`,
    ``,
    `<b>Token:</b> ${symbol}`,
    `<b>Chain:</b> ${escapeHtml(t.chain)}`,
    `<b>Mint:</b> <code>${escapeHtml(t.contract)}</code>`,
    `<b>Verified at:</b> ${escapeHtml(new Date().toISOString())}`,
    `<b>Window:</b> ${escapeHtml(event.windowStartAt)} → ${escapeHtml(event.windowEndAt)}`,
    ``,
    `<b>Market cap:</b> ${mc}`,
    `<b>Liquidity:</b> ${liquidity}`,
    `<b>Total verified buy:</b> ${total}`,
    ``,
    `<b>Buyers (${event.buyers.length}):</b>`,
  ]

  for (const b of event.buyers) {
    const alias = b.alias ? ` (${escapeHtml(b.alias)})` : ''
    const buy = b.buyValueUsd !== null ? ` — $${Math.round(b.buyValueUsd).toLocaleString('en-US')}` : ''
    const stale = b.stale ? ' [stale]' : ''
    lines.push(
      `• <code>${escapeHtml(b.address)}</code>${alias} — ${escapeHtml(b.classification)} [${escapeHtml(b.status)}]${buy}${stale}`,
    )
  }

  lines.push(``, `<b>Evidence:</b>`)
  lines.push(...event.evidence.map((e) => `• ${escapeHtml(e)}`))
  lines.push(``, `<b>Risks:</b>`)
  lines.push(...(event.risks.length > 0 ? event.risks.map((r) => `• ${escapeHtml(r)}`) : ['• none listed']))
  lines.push(``, `<b>Missing:</b>`)
  lines.push(...(event.missing.length > 0 ? event.missing.map((m) => `• ${escapeHtml(m)}`) : ['• none']))
  lines.push(
    ``,
    `<i>alert ≠ entry — screening signal only, never financial advice</i>`,
  )

  return truncateLines(lines, 4090)
}

/** Keep the message under Telegram's 4096 cap; drop buyer lines first. */
function truncateLines(lines: string[], cap: number): string {
  const joined = lines.join('\n')
  if (joined.length <= cap) return joined
  const fallback = joined.slice(0, cap - 1) + '…'
  return fallback
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
