// ─────────────────────────────────────────────────────────────
// Token holdings persist — populate TokenHolding from GMGN holder data.
//
// GAP: TokenHolding table has 232 rows from prisma/seed.ts static data,
// ZERO linked to whale-classified wallets. resolveCrossTokenContext()
// in accumulation-alert.ts always returns 'unknown' because
// walletHoldings is never populated from real data.
//
// This module fetches top holders for tokens with recent whale activity
// (WalletBuySignal rows) and upserts TokenHolding rows so the cross-token
// whale context in accumulation-alert can resolve to cross_token / same_token.
//
// Discipline (mirrors whale-buy-scanner.ts):
//   · per-token failure is tolerated — one dead token must not zero the run
//   · NEVER fabricates: missing USD stays 0, missing data is skipped
//   · idempotent: re-running updates existing rows rather than duplicating
//   · rate-limited between token fetches (matches scanner throttle)
// ─────────────────────────────────────────────────────────────

import type { GmgnHolderRow } from '@/lib/modules/meme/gmgn'
import { listGmgnTokenHolders } from '@/lib/modules/meme/gmgn'
import { prisma } from '@/lib/db'

/** Politeness gap between token holder fetches (ms). Mirrors WALLET_FETCH_GAP_MS. */
const TOKEN_FETCH_GAP_MS = 300

/** Default max tokens to scan per pass. */
const DEFAULT_TOKEN_LIMIT = 15

/** Default max holders to persist per token. */
const DEFAULT_HOLDER_LIMIT = 20

/**
 * Prisma client interface — injectable for tests so the pure logic can be
 * unit-tested without a live DB. Production code passes the real `prisma`.
 */
export interface PrismaLike {
  walletBuySignal: {
    findMany(args: {
      select?: unknown
      orderBy?: unknown
      take?: number
    }): Promise<Array<{ contract: string; chain: string }>>
  }
  wallet: {
    upsert(args: {
      where: { address: string }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }): Promise<{ id: string }>
  }
  token: {
    upsert(args: {
      where: { address_chain: { address: string; chain: string } }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }): Promise<{ id: string }>
  }
  tokenHolding: {
    upsert(args: {
      where: { walletId_tokenId: { walletId: string; tokenId: string } }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }): Promise<unknown>
  }
}

/**
 * Holder fetcher function type — injectable for tests.
 * Production code passes the real `listGmgnTokenHolders`.
 */
export type HolderFetcher = (chain: string, contract: string) => Promise<GmgnHolderRow[]>

export interface PersistResult {
  /** Number of tokens scanned. */
  tokensScanned: number
  /** Number of TokenHolding rows upserted. */
  holdingsUpserted: number
  /** Number of holders skipped (invalid address, non-finite USD, negative USD). */
  holdersSkipped: number
  /** One short string per failed token (honest accounting). */
  errors: string[]
}

export interface PersistOpts {
  /** Max tokens to scan (default 15). */
  tokenLimit?: number
  /** Max holders to persist per token (default 20). */
  holderLimit?: number
  /** Injectable prisma client (tests). */
  db?: PrismaLike
  /** Injectable holder fetcher (tests). */
  fetchHolders?: HolderFetcher
}

/**
 * Load distinct token contracts from recent WalletBuySignal rows.
 * These are the tokens whales are actively buying — the best candidates
 * for populating cross-token holding context.
 *
 * Returns distinct { contract, chain } pairs ordered by addedAt DESC.
 * Never throws — on DB failure returns [].
 */
export async function loadRecentWhaleTokens(
  db: PrismaLike,
  limit: number,
): Promise<Array<{ contract: string; chain: string }>> {
  try {
    const rows = await db.walletBuySignal.findMany({
      select: { contract: true, chain: true },
      orderBy: { addedAt: 'desc' },
      take: limit * 3, // over-fetch then dedup
    })
    const seen = new Set<string>()
    const out: Array<{ contract: string; chain: string }> = []
    for (const r of rows) {
      if (!r.contract || !r.chain) continue
      const key = `${r.chain}:${r.contract}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ contract: r.contract, chain: r.chain })
      if (out.length >= limit) break
    }
    return out
  } catch {
    return []
  }
}

/**
 * Validate a holder row: address must be non-empty, usdValue must be a
 * finite non-negative number, and the share of supply must be measured.
 * Returns the cleaned holder or null if invalid.
 *
 * NEVER writes NaN or negative usdValue — the schema column is Float and
 * NaN would corrupt downstream cross-token context resolution. An unmeasured
 * `amountPercentage` is refused for the same reason: `TokenHolding.amount` is
 * a non-null Float, so the only alternatives are an honest skip or a fake 0.
 */
export function validateHolder(h: GmgnHolderRow): GmgnHolderRow | null {
  if (!h.address || typeof h.address !== 'string' || h.address.length < 8) return null
  const usd = h.usdValue
  if (!Number.isFinite(usd) || usd < 0) return null
  // `TokenHolding.amount` is a non-null Float, so an unmeasured share has no
  // honest value to write: 0 would claim the wallet holds nothing, and the
  // column cannot hold "unknown". The row is skipped, never coerced.
  if (h.amountPercentage === null || !Number.isFinite(h.amountPercentage)) return null
  return h
}

/**
 * Resolve or create the Wallet row for a holder address, returning its
 * Prisma `id` (cuid). Idempotent: re-running updates lastSeen only.
 * Never throws — on failure returns null.
 */
async function resolveWalletId(
  db: PrismaLike,
  address: string,
  chain: string,
): Promise<string | null> {
  try {
    const w = await db.wallet.upsert({
      where: { address },
      create: {
        address,
        chain,
        labels: [],
        lastSeen: new Date(),
      },
      update: {
        lastSeen: new Date(),
      },
    })
    return w.id
  } catch {
    return null
  }
}

/**
 * Resolve or create the Token row for a contract, returning its Prisma `id`
 * (cuid). Idempotent: re-running does not modify existing token metadata.
 * Never throws — on failure returns null.
 */
async function resolveTokenId(
  db: PrismaLike,
  address: string,
  chain: string,
): Promise<string | null> {
  try {
    const t = await db.token.upsert({
      where: { address_chain: { address, chain } },
      create: {
        address,
        chain,
        name: address.slice(0, 10),
        symbol: address.slice(0, 6).toUpperCase(),
      },
      update: {},
    })
    return t.id
  } catch {
    return null
  }
}

/**
 * Persist a single token's holders into TokenHolding.
 * Returns { upserted, skipped } — never throws.
 */
async function persistTokenHolders(
  db: PrismaLike,
  chain: string,
  contract: string,
  holders: GmgnHolderRow[],
  holderLimit: number,
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0
  let skipped = 0

  // Resolve the Token row once per token.
  const tokenId = await resolveTokenId(db, contract, chain)
  if (!tokenId) {
    // Can't persist holdings without a Token FK — skip all holders.
    return { upserted: 0, skipped: holders.length }
  }

  const topHolders = holders.slice(0, holderLimit)

  for (const raw of topHolders) {
    const h = validateHolder(raw)
    if (!h) {
      skipped++
      continue
    }

    const share = h.amountPercentage
    if (share === null || !Number.isFinite(share)) {
      skipped++
      continue
    }

    const walletId = await resolveWalletId(db, h.address, chain)
    if (!walletId) {
      skipped++
      continue
    }

    if (!tokenId) {
      skipped++
      continue
    }

    try {
      await db.tokenHolding.upsert({
        where: { walletId_tokenId: { walletId, tokenId } },
        create: {
          walletId,
          tokenId,
          amount: share,
          usdValue: h.usdValue,
        },
        update: {
          amount: share,
          usdValue: h.usdValue,
        },
      })
      upserted++
    } catch {
      skipped++
    }
  }

  return { upserted, skipped }
}

/**
 * Main entry point: fetch holders for tokens with recent whale activity
 * and persist them into TokenHolding.
 *
 * Flow:
 *   1. Load distinct contracts from WalletBuySignal (addedAt DESC)
 *   2. For each token: fetch top holders via listGmgnTokenHolders
 *   3. For each holder: upsert Wallet + Token + TokenHolding
 *   4. Rate-limit between token fetches
 *
 * Per-token isolation: one dead token is logged + skipped. Never throws.
 */
export async function persistTokenHoldings(opts: PersistOpts = {}): Promise<PersistResult> {
  const tokenLimit = opts.tokenLimit ?? DEFAULT_TOKEN_LIMIT
  const holderLimit = opts.holderLimit ?? DEFAULT_HOLDER_LIMIT
  const db = opts.db ?? (prisma as unknown as PrismaLike)
  const fetchHolders = opts.fetchHolders ?? listGmgnTokenHolders

  const tokens = await loadRecentWhaleTokens(db, tokenLimit)
  if (tokens.length === 0) {
    return {
      tokensScanned: 0,
      holdingsUpserted: 0,
      holdersSkipped: 0,
      errors: ['no whale-buy signals found (WalletBuySignal table empty or unreadable)'],
    }
  }

  const errors: string[] = []
  let holdingsUpserted = 0
  let holdersSkipped = 0

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti]

    // Politeness gap between token fetches (skip on first).
    if (ti > 0) {
      await new Promise<void>((r) => setTimeout(r, TOKEN_FETCH_GAP_MS))
    }

    let holders: GmgnHolderRow[] = []
    try {
      holders = await fetchHolders(token.chain, token.contract)
    } catch (err) {
      errors.push(
        `holders:${token.contract}: ${err instanceof Error ? err.message.slice(0, 64) : 'err'}`,
      )
      continue
    }

    if (holders.length === 0) {
      errors.push(`holders:${token.contract}: empty`)
      continue
    }

    try {
      const res = await persistTokenHolders(db, token.chain, token.contract, holders, holderLimit)
      holdingsUpserted += res.upserted
      holdersSkipped += res.skipped
    } catch (err) {
      errors.push(
        `persist:${token.contract}: ${err instanceof Error ? err.message.slice(0, 64) : 'err'}`,
      )
    }
  }

  return {
    tokensScanned: tokens.length,
    holdingsUpserted,
    holdersSkipped,
    errors,
  }
}

