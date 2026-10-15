import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock @/lib/db's prisma client — one mock object per table.
const upsert = vi.fn()
const findMany = vi.fn()
const deleteMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    walletBuySignal: {
      upsert: (...args: unknown[]) => upsert(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
    confluencePrefetch: {
      upsert: (...args: unknown[]) => upsert(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
    callFeed: {
      upsert: (...args: unknown[]) => upsert(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
    botXKey: {
      upsert: (...args: unknown[]) => upsert(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      findUnique: (...args: unknown[]) => findMany(...args),
    },
  },
}))

import {
  isWalletBuysDbDisabled,
  loadWalletBuys,
  saveWalletBuys,
  pruneStaleWalletBuys,
  type WalletBuyRow,
} from '../db-wallet-buys'
import {
  isConfluencePrefetchDbDisabled,
  loadConfluencePrefetch,
  saveConfluencePrefetch,
} from '../db-confluence-prefetch'
import {
  isCallFeedDbDisabled,
  loadCallFeed,
  saveCallFeedRows,
  pruneStaleCallFeed,
} from '../db-call-feed'
import {
  isBotxDbDisabled,
  loadBotXKeys,
  loadBotXKeyByKeyValue,
  saveBotXKeys,
} from '../db-botx-keys'

let dir: string
let walletBuysPath: string
let confluencePath: string
let callFeedPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'db-crossproc-'))
  walletBuysPath = join(dir, 'wallet-buys-latest.json')
  confluencePath = join(dir, 'confluence-latest.json')
  callFeedPath = join(dir, 'call-feed-latest.json')
  process.env.WALLET_BUYS_PATH = walletBuysPath
  process.env.CONFLUENCE_LATEST_PATH = confluencePath
  process.env.CALL_FEED_PATH = callFeedPath
  upsert.mockReset()
  findMany.mockReset()
  deleteMany.mockReset()
})

afterEach(() => {
  delete process.env.WALLET_BUYS_PATH
  delete process.env.CONFLUENCE_LATEST_PATH
  delete process.env.CALL_FEED_PATH
  delete process.env.WALLET_BUYS_DB
  delete process.env.CONFLUENCE_PREFETCH_DB
  delete process.env.CALL_FEED_DB
  delete process.env.BOTX_DB
})

function walletRow(overrides: Partial<WalletBuyRow> = {}): WalletBuyRow {
  return {
    contract: 'GxH5FBoEd4rC28UmMZcMjYWPHNEvYau6yKRfibQXpump',
    chain: 'solana',
    buyers: ['F5EhA1gJVTNhS43bbxQjLb8uGM5WW5kBRzNuRmF2T1db'],
    buyVolumeUsd: 1500.5,
    buyCount: 2,
    firstBuyAt: 1760636400000,
    lastBuyAt: 1760636466000,
    ...overrides,
  }
}

describe('db-wallet-buys saveWalletBuys', () => {
  it('upserts each row by contract and dual-writes JSON', async () => {
    upsert.mockResolvedValue({})
    await saveWalletBuys([walletRow()])
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0] as {
      where: { contract: string }
      create: { contract: string; buyVolumeUsd: number; source: string }
    }
    expect(arg.where.contract).toBe('GxH5FBoEd4rC28UmMZcMjYWPHNEvYau6yKRfibQXpump')
    expect(arg.create.buyVolumeUsd).toBe(1500.5)
    expect(arg.create.source).toBe('wallet-refresh')
    // JSON dual-write landed.
    expect(existsSync(walletBuysPath)).toBe(true)
    const artifact = JSON.parse(readFileSync(walletBuysPath, 'utf8')) as {
      candidates: WalletBuyRow[]
    }
    expect(artifact.candidates).toHaveLength(1)
  })

  it('does nothing for empty input', async () => {
    await saveWalletBuys([])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never throws when the DB upsert fails', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    await expect(saveWalletBuys([walletRow()])).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

describe('db-wallet-buys loadWalletBuys', () => {
  it('returns DB rows when the DB has data', async () => {
    const date = new Date('2026-10-15T12:00:00.000Z')
    findMany.mockResolvedValue([
      {
        contract: 'mintA',
        chain: 'solana',
        buyVolumeUsd: 1000,
        buyCount: 1,
        firstBuyAt: date,
        lastBuyAt: date,
        buyers: ['buyerA'],
      },
    ])
    const result = await loadWalletBuys()
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe('mintA')
    expect(result[0].buyers).toEqual(['buyerA'])
  })

  it('falls back to JSON when DB has no rows', async () => {
    findMany.mockResolvedValue([])
    writeFileSync(
      walletBuysPath,
      JSON.stringify({
        generated_at: new Date().toISOString(),
        min_usd: 2000,
        window_min: 60,
        candidates: [walletRow({ contract: 'jsonMint' })],
      }),
    )
    const result = await loadWalletBuys()
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe('jsonMint')
  })

  it('falls back to JSON without throwing when DB fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    await expect(loadWalletBuys()).resolves.toEqual([])
  })
})

describe('db-wallet-buys pruneStaleWalletBuys', () => {
  it('deletes rows older than maxAgeMin and returns the count', async () => {
    deleteMany.mockResolvedValue({ count: 3 })
    const result = await pruneStaleWalletBuys(120)
    expect(result).toBe(3)
    expect(deleteMany).toHaveBeenCalledTimes(1)
  })

  it('returns -1 when the DB fails', async () => {
    deleteMany.mockRejectedValue(new Error('db down'))
    const result = await pruneStaleWalletBuys()
    expect(result).toBe(-1)
  })
})

describe('kill-switch WALLET_BUYS_DB=off', () => {
  it('saveWalletBuys skips prisma entirely but still dual-writes JSON', async () => {
    process.env.WALLET_BUYS_DB = 'off'
    await saveWalletBuys([walletRow()])
    expect(upsert).not.toHaveBeenCalled()
    expect(existsSync(walletBuysPath)).toBe(true)
  })

  it('loadWalletBuys reads JSON only and never calls prisma', async () => {
    process.env.WALLET_BUYS_DB = 'off'
    writeFileSync(
      walletBuysPath,
      JSON.stringify({
        generated_at: new Date().toISOString(),
        min_usd: 2000,
        window_min: 60,
        candidates: [walletRow({ contract: 'killMint' })],
      }),
    )
    const result = await loadWalletBuys()
    expect(result[0].contract).toBe('killMint')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('isWalletBuysDbDisabled returns true for off/false/0', () => {
    process.env.WALLET_BUYS_DB = 'off'
    expect(isWalletBuysDbDisabled()).toBe(true)
    process.env.WALLET_BUYS_DB = 'false'
    expect(isWalletBuysDbDisabled()).toBe(true)
    process.env.WALLET_BUYS_DB = '0'
    expect(isWalletBuysDbDisabled()).toBe(true)
    process.env.WALLET_BUYS_DB = 'on'
    expect(isWalletBuysDbDisabled()).toBe(false)
    delete process.env.WALLET_BUYS_DB
    expect(isWalletBuysDbDisabled()).toBe(false)
  })
})

describe('db-confluence-prefetch', () => {
  const prefetchRow = {
    contract: 'F2j4ER8DnWY5HNW1J79mYY64Q6xEFmPrMmf7NQxhpump',
    chain: 'solana',
    buyers: ['F5EhA1gJVTNhS43bbxQjLb8uGM5WW5kBRzNuRmF2T1db'],
    totalBuyUsd: 1100.81,
    firstBuyAt: 1792085920000,
    lastBuyAt: 1792086466000,
  }

  it('saveConfluencePrefetch upserts by contract + dual-writes JSON', async () => {
    upsert.mockResolvedValue({})
    const path = await saveConfluencePrefetch([prefetchRow])
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0] as { where: { contract: string } }
    expect(arg.where.contract).toBe(prefetchRow.contract)
    expect(typeof path).toBe('string')
  })

  it('loadConfluencePrefetch returns DB rows when present', async () => {
    findMany.mockResolvedValue([
      {
        contract: prefetchRow.contract,
        chain: 'solana',
        signals: {
          buyers: prefetchRow.buyers,
          totalBuyUsd: prefetchRow.totalBuyUsd,
          firstBuyAt: prefetchRow.firstBuyAt,
          lastBuyAt: prefetchRow.lastBuyAt,
        },
      },
    ])
    const result = await loadConfluencePrefetch()
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe(prefetchRow.contract)
    expect(result[0].totalBuyUsd).toBe(1100.81)
  })

  it('loadConfluencePrefetch falls back to JSON without throwing', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    await expect(loadConfluencePrefetch()).resolves.toEqual([])
  })

  it('kill-switch CONFLUENCE_PREFETCH_DB=off skips prisma', async () => {
    process.env.CONFLUENCE_PREFETCH_DB = 'off'
    expect(isConfluencePrefetchDbDisabled()).toBe(true)
    await saveConfluencePrefetch([prefetchRow])
    expect(upsert).not.toHaveBeenCalled()
    delete process.env.CONFLUENCE_PREFETCH_DB
    expect(isConfluencePrefetchDbDisabled()).toBe(false)
  })
})

describe('db-call-feed', () => {
  const callRow = {
    contract: 'BdCAHyagzkfNjPmkGfPHyx695dUcdW24UXxydxjLpump',
    chain: 'solana',
    sources: ['SeekrTrending'],
    sourceCount: 4,
    mentions: 6,
    kinds: ['score'],
    firstSeen: '2026-10-15T19:31:47+00:00',
    lastSeen: '2026-10-15T19:47:20+00:00',
    weightedScore: 6.0,
  }

  it('saveCallFeedRows upserts each row by contract', async () => {
    upsert.mockResolvedValue({})
    await saveCallFeedRows([callRow])
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0] as { where: { contract: string } }
    expect(arg.where.contract).toBe(callRow.contract)
  })

  it('loadCallFeed returns DB rows when present', async () => {
    findMany.mockResolvedValue([
      {
        contract: callRow.contract,
        chain: 'solana',
        ticker: '',
        marketCapUsd: null,
        mentionCount: 6,
        lastSeenAt: new Date('2026-10-15T19:47:20+00:00'),
      },
    ])
    const result = await loadCallFeed()
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe(callRow.contract)
    expect(result[0].mentions).toBe(6)
  })

  it('loadCallFeed falls back to JSON without throwing', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    await expect(loadCallFeed()).resolves.toEqual([])
  })

  it('pruneStaleCallFeed returns the deleted count', async () => {
    deleteMany.mockResolvedValue({ count: 2 })
    const result = await pruneStaleCallFeed()
    expect(result).toBe(2)
  })

  it('kill-switch CALL_FEED_DB=off skips prisma', async () => {
    process.env.CALL_FEED_DB = 'off'
    expect(isCallFeedDbDisabled()).toBe(true)
    await saveCallFeedRows([callRow])
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('db-botx-keys', () => {
  const botxRow = {
    id: 'abc123',
    apiKey: 'test-key-value',
    email: 'test@example.com',
    createdAt: 1760636400000,
    lastUsed: 1760636466000,
    lastChecked: 1760636466000,
    isHealthy: true,
    rateLimited: false,
    errorCount: 0,
    requestCount: 5,
  }

  it('saveBotXKeys upserts each row by apiKey', async () => {
    upsert.mockResolvedValue({})
    await saveBotXKeys([botxRow])
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0] as { where: { apiKey: string } }
    expect(arg.where.apiKey).toBe('test-key-value')
  })

  it('loadBotXKeys returns DB rows ordered ASC', async () => {
    findMany.mockResolvedValue([
      {
        id: 'cuid-1',
        apiKey: botxRow.apiKey,
        email: botxRow.email,
        createdAt: new Date(botxRow.createdAt),
        lastUsed: new Date(botxRow.lastUsed),
        lastChecked: new Date(botxRow.lastChecked),
        isHealthy: true,
        rateLimited: false,
        errorCount: 0,
        requestCount: 5,
      },
    ])
    const result = await loadBotXKeys()
    expect(result).toHaveLength(1)
    expect(result[0].apiKey).toBe('test-key-value')
    expect(result[0].requestCount).toBe(5)
  })

  it('loadBotXKeyByKeyValue returns null on DB failure', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    await expect(loadBotXKeyByKeyValue('any')).resolves.toBeNull()
  })

  it('loadBotXKeys returns [] on DB failure', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    await expect(loadBotXKeys()).resolves.toEqual([])
  })

  it('kill-switch BOTX_DB=off skips prisma', async () => {
    process.env.BOTX_DB = 'off'
    expect(isBotxDbDisabled()).toBe(true)
    await saveBotXKeys([botxRow])
    expect(upsert).not.toHaveBeenCalled()
    await expect(loadBotXKeys()).resolves.toEqual([])
  })
})
