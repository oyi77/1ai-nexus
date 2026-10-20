// ─────────────────────────────────────────────────────────────
// Persistent registry of every whale wallet the scanner has caught.
//
// Why a registry instead of reading WalletBuySignal alone: the scanner prunes
// candidates after 6 hours, so a DB-only view forgets yesterday's whales. The
// operator's sheet must stay cumulative AND current, so this module keeps a
// durable ledger keyed by wallet address:
//
//   • timesCaught     — how many scan passes have caught this wallet buying
//   • firstCaughtAt   — first time ever seen by the scanner
//   • lastCaughtAt    — most recent catch (drives "is this whale still active")
//   • tokens          — most recent contracts, newest first (bounded)
//   • identity        — alias / status / winRate / pnl30d from SmartMoneyWallet
//
// Invariants: never throws, corrupt JSON degrades to an empty registry, and
// merging is pure so the sheet mapper can be unit tested without I/O.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'
import type { WhaleBuyRow } from '@/lib/modules/derived/whale-buy-store'

/** Contracts remembered per wallet — enough context, never unbounded. */
export const MAX_TOKENS_PER_WALLET = 10

export interface WhaleWalletRecord {
  address: string
  alias: string | null
  status: string | null
  winRate: number | null
  pnl30d: number | null
  labels: string[]
  timesCaught: number
  firstCaughtAt: number
  lastCaughtAt: number
  /** Contracts, newest first. */
  tokens: string[]
}

export interface WhaleIdentity {
  alias: string | null
  status: string | null
  winRate: number | null
  pnl30d: number | null
  labels: string[]
}

export function whaleRegistryJsonPath(): string {
  return (
    process.env.WHALE_REGISTRY_PATH ?? join(process.cwd(), 'data', 'whale-wallets-registry.json')
  )
}

/**
 * Read the registry. Returns [] when the file is missing or corrupt — a broken
 * artifact must never stop the scan cron.
 */
export function loadWhaleRegistry(): WhaleWalletRecord[] {
  try {
    const p = whaleRegistryJsonPath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { wallets?: unknown }
    if (!Array.isArray(raw?.wallets)) return []
    return raw.wallets.filter((w): w is WhaleWalletRecord => {
      const r = w as WhaleWalletRecord
      return typeof r?.address === 'string' && typeof r?.timesCaught === 'number'
    })
  } catch (err) {
    console.error(
      `[whale-registry] read failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

export function saveWhaleRegistry(wallets: WhaleWalletRecord[]): void {
  try {
    const p = whaleRegistryJsonPath()
    mkdirSync(dirname(p), { recursive: true })
    const payload = {
      generated_at: new Date().toISOString(),
      wallets: [...wallets].sort((a, b) => b.lastCaughtAt - a.lastCaughtAt),
    }
    writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    console.error(
      `[whale-registry] write failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Fold this pass's scanner rows into the registry.
 *
 * Each buyer of each candidate token counts as one catch of that wallet.
 * Identity fields are refreshed from `identities` when present, and kept
 * as-is otherwise (an unclassified wallet must not erase a known alias).
 * Pure — the caller persists the result.
 */
export function mergeWhaleRegistry(
  existing: WhaleWalletRecord[],
  rows: WhaleBuyRow[],
  identities: Map<string, WhaleIdentity>,
  nowMs: number,
): WhaleWalletRecord[] {
  const byAddress = new Map<string, WhaleWalletRecord>()
  for (const rec of existing) byAddress.set(rec.address, { ...rec })

  for (const row of rows) {
    for (const buyer of row.buyers ?? []) {
      if (!buyer) continue
      const prev = byAddress.get(buyer)
      const caughtAt = row.lastBuyAt ?? nowMs
      const identity = identities.get(buyer)

      if (!prev) {
        byAddress.set(buyer, {
          address: buyer,
          alias: identity?.alias ?? null,
          status: identity?.status ?? null,
          winRate: identity?.winRate ?? null,
          pnl30d: identity?.pnl30d ?? null,
          labels: identity?.labels ?? [],
          timesCaught: 1,
          firstCaughtAt: caughtAt,
          lastCaughtAt: caughtAt,
          tokens: row.contract ? [row.contract] : [],
        })
        continue
      }

      const tokens = row.contract
        ? [row.contract, ...prev.tokens.filter((t) => t !== row.contract)]
        : prev.tokens

      byAddress.set(buyer, {
        ...prev,
        alias: identity?.alias ?? prev.alias,
        status: identity?.status ?? prev.status,
        winRate: identity?.winRate ?? prev.winRate,
        pnl30d: identity?.pnl30d ?? prev.pnl30d,
        labels: identity && identity.labels.length > 0 ? identity.labels : prev.labels,
        timesCaught: prev.timesCaught + 1,
        firstCaughtAt: Math.min(prev.firstCaughtAt, caughtAt),
        lastCaughtAt: Math.max(prev.lastCaughtAt, caughtAt),
        tokens: tokens.slice(0, MAX_TOKENS_PER_WALLET),
      })
    }
  }

  return [...byAddress.values()]
}

/**
 * Look up identity rows for the given addresses. Never throws — on a DB
 * failure every wallet simply keeps its JSON-side identity.
 */
export async function loadWhaleIdentities(addresses: string[]): Promise<Map<string, WhaleIdentity>> {
  const out = new Map<string, WhaleIdentity>()
  const unique = [...new Set(addresses.filter(Boolean))]
  if (unique.length === 0) return out
  try {
    const rows = await prisma.smartMoneyWallet.findMany({
      where: { wallet: { address: { in: unique } } },
      select: {
        status: true,
        winRate: true,
        pnl30d: true,
        wallet: { select: { address: true, alias: true, labels: true } },
      },
    })
    for (const r of rows) {
      const address = r.wallet?.address
      if (!address) continue
      out.set(address, {
        alias: r.wallet.alias ?? null,
        status: r.status ?? null,
        winRate: r.winRate ?? null,
        pnl30d: r.pnl30d ?? null,
        labels: r.wallet.labels ?? [],
      })
    }
  } catch (err) {
    console.error(
      `[whale-registry] identity lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out
}
