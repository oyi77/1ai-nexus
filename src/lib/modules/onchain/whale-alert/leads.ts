// ─────────────────────────────────────────────────────────────
// Whale-alert → wallet-ingestion leads (pure, zero I/O).
//
// The fetcher (fetcher.ts) scrapes t.me/s/whale_alert_io for large
// transfers.  Until now that output only fed the whale-transfers
// sentiment provider — it never became a wallet-ingestion lead.
// This module bridges that gap: filters alerts by USD, extracts
// addresses from the `from`/`to` free-text fields, and returns
// persistable leads for the Wallet table.
//
// Discipline:
//   - NEVER fabricates: an item whose from/to are exchange names
//     ("Binance", "Unknown Wallet") produces ZERO leads — skipped,
//     not zero-USD.  Only values that match a known address format
//     (EVM 0x+40hex, Solana base58 32-44) become leads.
//   - Chain is derived from the address format, never guessed from
//     the token symbol (USDT could be on Ethereum, Tron, or BSC).
//   - minUsd is configurable; default $5M matches the existing
//     whale-transfers provider threshold.
// Pure — zero I/O, no network, no DB.
// ─────────────────────────────────────────────────────────────

import type { WhaleAlertItem } from './fetcher'

/** Default USD floor for a sighting to become a lead. */
export const WHALE_ALERT_LEAD_DEFAULT_MIN_USD = 5_000_000

export interface WhaleAlertLeadOptions {
  /** Minimum transfer USD to qualify. Default $5M. */
  minUsd?: number
}

/**
 * A wallet-ingestion lead extracted from a whale-alert sighting.
 * The `side` tells whether the address was the source or destination.
 */
export interface WhaleAlertLead {
  address: string
  chain: string
  /** "from" = the address sent the transfer; "to" = it received. */
  side: 'from' | 'to'
  usd: number
  symbol: string
  /** Original alert id — for dedup / provenance traceability. */
  alertId: string
  source: 'whale-alert'
}

// ── Address detection ────────────────────────────────────────

/**
 * EVM address: 0x followed by exactly 40 hex chars (case-insensitive).
 * Covers Ethereum, BSC, Polygon, Arbitrum, Base, Optimism.
 */
function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s)
}

/**
 * Solana base58 address: 32-44 chars, no 0/O/I/l, starts with a
 * non-zero byte (so never starts with '1').  This is a heuristic —
 * we cannot validate checksums without a dep, but the format check
 * eliminates exchange names and "Unknown Wallet".
 */
function isSolanaAddress(s: string): boolean {
  if (s.length < 32 || s.length > 44) return false
  // Base58 alphabet: no 0, O, I, l
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return false
  // Solana addresses never start with '1' (that's a Bitcoin P2PKH prefix)
  return !s.startsWith('1')
}

/**
 * Detect chain from address format. Returns null when the string is
 * not a recognizable blockchain address (exchange name, "Unknown
 * Wallet", truncated address with ellipsis, etc.).
 */
export function detectChainFromAddress(s: string): string | null {
  const trimmed = s.trim()
  if (trimmed.length === 0) return null
  if (isEvmAddress(trimmed)) return 'ethereum'
  if (isSolanaAddress(trimmed)) return 'solana'
  return null
}

/**
 * Extract wallet-ingestion leads from whale-alert sightings.
 *
 * For each item above the USD floor, checks whether `from` or `to`
 * is a recognizable blockchain address.  Items where both are
 * exchange names ("Binance", "Unknown Wallet") produce zero leads —
 * they are skipped, not fabricated.
 *
 * A single item can produce up to two leads (one for `from`, one
 * for `to`) when both sides are addresses.
 */
export function extractWhaleAlertLeads(
  items: WhaleAlertItem[],
  opts: WhaleAlertLeadOptions = {},
): WhaleAlertLead[] {
  const minUsd = opts.minUsd ?? WHALE_ALERT_LEAD_DEFAULT_MIN_USD
  const leads: WhaleAlertLead[] = []

  for (const item of items) {
    // NEVER fabricate: invalid USD = skip, not zero.
    if (typeof item.usd !== 'number' || !Number.isFinite(item.usd) || item.usd <= 0) continue
    if (item.usd < minUsd) continue

    const fromChain = detectChainFromAddress(item.from)
    const toChain = detectChainFromAddress(item.to)

    if (fromChain) {
      leads.push({
        address: item.from.trim(),
        chain: fromChain,
        side: 'from',
        usd: item.usd,
        symbol: item.symbol,
        alertId: item.id,
        source: 'whale-alert',
      })
    }
    if (toChain) {
      leads.push({
        address: item.to.trim(),
        chain: toChain,
        side: 'to',
        usd: item.usd,
        symbol: item.symbol,
        alertId: item.id,
        source: 'whale-alert',
      })
    }
    // Neither is an address → skip silently (exchange-to-exchange).
  }

  return leads
}

// ── Wallet persistence ───────────────────────────────────────
// The leads above are pure. This helper takes them to the Wallet table.
// Imported via dynamic import from data-refresher (same pattern as the
// fetcher import there) to avoid pulling Prisma into the edge cache path.

import { prisma } from '@/lib/db'

/**
 * Persist whale-alert leads into the Wallet table. Per-lead failure
 * isolation; never throws.  Create: chain, labels ['whale-alert',
 * 'whale-lead'], lastSeen=now. Update: lastSeen=now only (labels
 * preserved — this is a sighting, not a re-import).
 */
export async function persistWhaleAlertLeads(
  leads: WhaleAlertLead[],
): Promise<{ created: number; updated: number; failed: number }> {
  let created = 0
  let updated = 0
  let failed = 0
  if (leads.length === 0) return { created, updated, failed }

  // Pre-check existence in ONE query so we can report created vs updated.
  const addresses = [...new Set(leads.map((l) => l.address))]
  let existing: Set<string>
  try {
    const rows = await prisma.wallet.findMany({
      where: { address: { in: addresses } },
      select: { address: true },
    })
    existing = new Set(rows.map((r) => r.address))
  } catch {
    existing = new Set()
  }

  for (const lead of leads) {
    try {
      await prisma.wallet.upsert({
        where: { address: lead.address },
        create: {
          address: lead.address,
          chain: lead.chain,
          labels: ['whale-alert', 'whale-lead'],
          lastSeen: new Date(),
        },
        update: { lastSeen: new Date() },
      })
      if (existing.has(lead.address)) updated += 1
      else {
        created += 1
        existing.add(lead.address)
      }
    } catch {
      failed += 1
    }
  }
  return { created, updated, failed }
}
