// ─────────────────────────────────────────────────────────────
// token-holdings-persist tests — pure persist logic, hermetic.
//
// The module takes an injectable `db` (PrismaLike) and `fetchHolders`
// (HolderFetcher), so every test runs without a live Postgres connection
// or a live GMGN call. Covers:
//   · upserts new holdings
//   · updates existing (idempotent — same unique key, update path)
//   · skips tokens with no holders
//   · handles holder fetch throwing (doesn't crash the run)
//   · never writes NaN/negative usdValue
//   · per-token isolation (one bad token doesn't zero the others)
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest'
import {
  loadRecentWhaleTokens,
  persistTokenHoldings,
  validateHolder,
  type PrismaLike,
} from '../token-holdings-persist'
import type { GmgnHolderRow } from '@/lib/modules/meme/gmgn'

const TOKEN_A = 'TokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const TOKEN_B = 'TokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const WALLET_1 = 'Wallet11111111111111111111111111111111111111'
const WALLET_2 = 'Wallet22222222222222222222222222222222222222'

/**
 * Minimal in-memory PrismaLike double. Records every upsert so tests can
 * assert on the exact payload (idempotency key, usdValue never NaN).
 */
function makeDb(signals: Array<{ contract: string; chain: string }>) {
  const walletUpserts: Array<{ where: { address: string }; create: Record<string, unknown> }> = []
  const tokenUpserts: Array<{ where: { address_chain: { address: string; chain: string } } }> = []
  const holdingUpserts: Array<{
    where: { walletId_tokenId: { walletId: string; tokenId: string } }
    create: Record<string, unknown>
    update: Record<string, unknown>
  }> = []

  const db: PrismaLike = {
    walletBuySignal: {
      findMany: async () => signals,
    },
    wallet: {
      upsert: async (args) => {
        walletUpserts.push({ where: args.where, create: args.create })
        return { id: `wallet-${args.where.address}` }
      },
    },
    token: {
      upsert: async (args) => {
        tokenUpserts.push({ where: args.where })
        return { id: `token-${args.where.address_chain.address}` }
      },
    },
    tokenHolding: {
      upsert: async (args) => {
        holdingUpserts.push(args)
        return { id: 'holding' }
      },
    },
  }

  return { db, walletUpserts, tokenUpserts, holdingUpserts }
}

function holder(over: Partial<GmgnHolderRow> = {}): GmgnHolderRow {
  return {
    address: WALLET_1,
    amountPercentage: 0.025,
    costCur: 100,
    usdValue: 154_769.92,
    unrealizedProfit: 12.4,
    realizedProfit: 0,
    suspicious: false,
    tags: ['top_holder'],
    ...over,
  }
}

describe('validateHolder', () => {
  it('accepts a well-formed holder row', () => {
    expect(validateHolder(holder())).not.toBeNull()
  })

  it('rejects a holder with an empty address', () => {
    expect(validateHolder(holder({ address: '' }))).toBeNull()
  })

  it('rejects a holder with a too-short address', () => {
    expect(validateHolder(holder({ address: 'abc' }))).toBeNull()
  })

  it('rejects NaN usdValue', () => {
    expect(validateHolder(holder({ usdValue: Number.NaN }))).toBeNull()
  })

  it('rejects Infinity usdValue', () => {
    expect(validateHolder(holder({ usdValue: Number.POSITIVE_INFINITY }))).toBeNull()
  })

  it('rejects negative usdValue', () => {
    expect(validateHolder(holder({ usdValue: -1 }))).toBeNull()
  })

  it('accepts zero usdValue (real zero is not fabricated)', () => {
    expect(validateHolder(holder({ usdValue: 0 }))).not.toBeNull()
  })
})

describe('loadRecentWhaleTokens', () => {
  it('dedups signal rows by chain:contract, preserving first-seen order', async () => {
    const { db } = makeDb([
      { contract: TOKEN_A, chain: 'solana' },
      { contract: TOKEN_A, chain: 'solana' },
      { contract: TOKEN_B, chain: 'solana' },
    ])
    const out = await loadRecentWhaleTokens(db, 10)
    expect(out).toEqual([
      { contract: TOKEN_A, chain: 'solana' },
      { contract: TOKEN_B, chain: 'solana' },
    ])
  })

  it('respects the limit', async () => {
    const { db } = makeDb([
      { contract: TOKEN_A, chain: 'solana' },
      { contract: TOKEN_B, chain: 'solana' },
    ])
    const out = await loadRecentWhaleTokens(db, 1)
    expect(out).toEqual([{ contract: TOKEN_A, chain: 'solana' }])
  })

  it('returns [] when the signal query throws (never propagates)', async () => {
    const db = {
      ...makeDb([]).db,
      walletBuySignal: {
        findMany: async () => {
          throw new Error('db down')
        },
      },
    }
    await expect(loadRecentWhaleTokens(db, 10)).resolves.toEqual([])
  })
})

describe('persistTokenHoldings', () => {
  it('upserts holdings for every valid holder of a token', async () => {
    const { db, holdingUpserts } = makeDb([{ contract: TOKEN_A, chain: 'solana' }])
    const fetchHolders = vi.fn(async () => [
      holder({ address: WALLET_1, usdValue: 100_000 }),
      holder({ address: WALLET_2, usdValue: 50_000 }),
    ])

    const res = await persistTokenHoldings({ db, fetchHolders })

    expect(res.tokensScanned).toBe(1)
    expect(res.holdingsUpserted).toBe(2)
    expect(res.holdersSkipped).toBe(0)
    expect(res.errors).toEqual([])
    expect(holdingUpserts).toHaveLength(2)
    // Unique key is the Prisma compound (walletId, tokenId).
    expect(holdingUpserts[0].where.walletId_tokenId.tokenId).toBe(`token-${TOKEN_A}`)
    expect(holdingUpserts[0].create.usdValue).toBe(100_000)
  })

  it('is idempotent — a re-run reuses the same unique key (update path, no dup)', async () => {
    const signals = [{ contract: TOKEN_A, chain: 'solana' }]
    const fetchHolders = async () => [holder({ address: WALLET_1, usdValue: 100 })]
    const first = makeDb(signals)

    await persistTokenHoldings({ db: first.db, fetchHolders })
    await persistTokenHoldings({ db: first.db, fetchHolders })

    // Two upsert CALLS, both targeting the same compound key — the DB
    // collapses them to one row. Assert the key is stable across runs.
    expect(first.holdingUpserts).toHaveLength(2)
    const [a, b] = first.holdingUpserts
    expect(a.where.walletId_tokenId).toEqual(b.where.walletId_tokenId)
    // The update payload carries the fresh value, never a duplicate insert.
    expect(b.update.usdValue).toBe(100)
  })

  it('skips a token that returns no holders (records an honest error)', async () => {
    const { db, holdingUpserts } = makeDb([{ contract: TOKEN_A, chain: 'solana' }])
    const fetchHolders = vi.fn(async () => [])

    const res = await persistTokenHoldings({ db, fetchHolders })

    expect(res.holdingsUpserted).toBe(0)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toContain('empty')
    expect(holdingUpserts).toHaveLength(0)
  })

  it('never crashes the run when a holder fetch throws — other tokens still persist', async () => {
    const { db, holdingUpserts } = makeDb([
      { contract: TOKEN_A, chain: 'solana' },
      { contract: TOKEN_B, chain: 'solana' },
    ])
    const fetchHolders = vi.fn(async (_chain: string, contract: string) => {
      if (contract === TOKEN_A) throw new Error('GMGN 403')
      return [holder({ address: WALLET_2, usdValue: 999 })]
    })

    const res = await persistTokenHoldings({ db, fetchHolders })

    expect(res.tokensScanned).toBe(2)
    expect(res.holdingsUpserted).toBe(1) // TOKEN_B still persisted
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toContain('holders:')
    expect(holdingUpserts).toHaveLength(1)
  })

  it('never writes NaN or negative usdValue — those holders are skipped', async () => {
    const { db, holdingUpserts } = makeDb([{ contract: TOKEN_A, chain: 'solana' }])
    const fetchHolders = async () => [
      holder({ address: WALLET_1, usdValue: Number.NaN }),
      holder({ address: WALLET_2, usdValue: -5 }),
      holder({ address: 'ok3333333333333333333333333333333333333333', usdValue: 42 }),
    ]

    const res = await persistTokenHoldings({ db, fetchHolders })

    expect(res.holdingsUpserted).toBe(1)
    expect(res.holdersSkipped).toBe(2)
    for (const u of holdingUpserts) {
      expect(Number.isFinite(u.create.usdValue as number)).toBe(true)
      expect(u.create.usdValue as number).toBeGreaterThanOrEqual(0)
    }
  })

  it('caps holders per token at holderLimit', async () => {
    const { db, holdingUpserts } = makeDb([{ contract: TOKEN_A, chain: 'solana' }])
    const many = Array.from({ length: 30 }, (_, i) =>
      holder({ address: `w${String(i).padStart(43, '0')}`, usdValue: 1000 + i }),
    )
    const fetchHolders = async () => many

    const res = await persistTokenHoldings({ db, fetchHolders, holderLimit: 5 })

    expect(res.holdingsUpserted).toBe(5)
    expect(holdingUpserts).toHaveLength(5)
  })

  it('returns an honest error when there are no whale-buy signals', async () => {
    const { db } = makeDb([])
    const res = await persistTokenHoldings({ db, fetchHolders: async () => [] })
    expect(res.tokensScanned).toBe(0)
    expect(res.errors[0]).toContain('no whale-buy signals')
  })
})
