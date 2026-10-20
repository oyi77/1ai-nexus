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
  /** Times each source caught this wallet, e.g. `{ 'whale-scan': 3 }`. */
  sources: Record<string, number>
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
    return raw.wallets
      .filter((w) => {
        const r = w as WhaleWalletRecord
        return typeof r?.address === 'string' && typeof r?.timesCaught === 'number'
      })
      .map((w) => {
        const r = w as WhaleWalletRecord
        // Records written before provenance existed carry no `sources`.
        // They still have a total in `timesCaught`, so bucket it as `legacy`
        // rather than inventing a false source name — this keeps every sheet
        // row at the same width.
        const sources = r.sources ?? {}
        const attributed = Object.values(sources).reduce((a, b) => a + b, 0)
        return attributed > 0 ? { ...r, sources } : { ...r, sources: { legacy: r.timesCaught } }
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
 * One catch of one whale wallet by one source, e.g. the token scanner's
 * "wallet X bought contract Y" or the KOL monitor's "wallet X passed the gate".
 */
export interface WalletCatch {
  address: string
  /** Source id, stable across passes: 'whale-scan' | 'kolscan' | 'axiom'. */
  source: string
  caughtAt: number
  /** Optional token bought/most associated with the catch. */
  token?: string
  identity?: WhaleIdentity
}

/** Map a token-scanner batch into generic catches (one per buyer per row). */
export function catchesFromScanRows(
  rows: WhaleBuyRow[],
  nowMs: number,
  source = 'whale-scan',
): WalletCatch[] {
  return rows.flatMap((row) =>
    (row.buyers ?? [])
      .filter(Boolean)
      .map((buyer) => ({
        address: buyer,
        source,
        caughtAt: row.lastBuyAt ?? nowMs,
        token: row.contract,
      })),
  )
}

/**
 * Fold catches into the registry.
 *
 * One catch per catch. Identity fields are refreshed from `catch.identity`
 * when present and kept as-is otherwise (an unclassified source must not
 * erase a known alias). Pure — the caller persists the result.
 */
export function mergeWhaleRegistry(
  existing: WhaleWalletRecord[],
  catches: WalletCatch[],
): WhaleWalletRecord[] {
  const byAddress = new Map<string, WhaleWalletRecord>()
  for (const rec of existing) {
    byAddress.set(rec.address, { ...rec, sources: { ...(rec.sources ?? {}) } })
  }

  for (const c of catches) {
    if (!c.address) continue
    const prev = byAddress.get(c.address)

    if (!prev) {
      byAddress.set(c.address, {
        address: c.address,
        alias: c.identity?.alias ?? null,
        status: c.identity?.status ?? null,
        winRate: c.identity?.winRate ?? null,
        pnl30d: c.identity?.pnl30d ?? null,
        labels: c.identity?.labels ?? [],
        timesCaught: 1,
        firstCaughtAt: c.caughtAt,
        lastCaughtAt: c.caughtAt,
        tokens: c.token ? [c.token] : [],
        sources: { [c.source]: 1 },
      })
      continue
    }

    const tokens =
      c.token && c.token !== prev.tokens[0]
        ? [c.token, ...prev.tokens.filter((t) => t !== c.token)]
        : prev.tokens

    byAddress.set(c.address, {
      ...prev,
      alias: c.identity?.alias ?? prev.alias,
      status: c.identity?.status ?? prev.status,
      winRate: c.identity?.winRate ?? prev.winRate,
      pnl30d: c.identity?.pnl30d ?? prev.pnl30d,
      labels: c.identity && c.identity.labels.length > 0 ? c.identity.labels : prev.labels,
      timesCaught: prev.timesCaught + 1,
      firstCaughtAt: Math.min(prev.firstCaughtAt, c.caughtAt),
      lastCaughtAt: Math.max(prev.lastCaughtAt, c.caughtAt),
      tokens: tokens.slice(0, MAX_TOKENS_PER_WALLET),
      sources: { ...prev.sources, [c.source]: (prev.sources[c.source] ?? 0) + 1 },
    })
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
