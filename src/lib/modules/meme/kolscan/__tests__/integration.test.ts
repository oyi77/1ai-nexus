import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KolscanScreenedTx } from '../index'
import { filterUnseenTransactionsDb, markTransactionsSeenDb } from '../seen'

// Dynamic import exception (ts-no-dynamic-import): `fetchSolPriceUsd` memoises a
// 5-minute SOL price at module scope, so a static `../index` import would leak
// that cache across cases. Each test reloads a fresh module registry via
// `await import('../index')` (same reason as kolscan.test.ts' fetchKolscanFeed).

// ─────────────────────────────────────────────────────────────
// Test fixtures: valid base58 Solana addresses and signatures
// ─────────────────────────────────────────────────────────────

// Base58 alphabet: [1-9A-HJ-NP-Za-km-z] (no 0, O, I, l)
// Solana public keys: 43-44 base58 chars
const WALLET_A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const WALLET_B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const MINT_X = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const EVM_A = '0x1234567890123456789012345678901234567890'

// Signatures: base58-safe (regex matches [A-Za-z0-9]+)
const SIG_SHARED = '5KnmqV7WzY9QeP8F7v3M8zW9x1B4Y2C6d7E8f9G1h2J3k4L5m6N7p8Q9r1S2t3U4v5W6x7Y8z9A1b2C3d4E5f6G'
const SIG_KEYLESS = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofMTS5A9r27t2uYj8hNupqbhBvnJ5XU5xP8N2d6hG7zM9sK'
const SIG_HTML = '3vRfwK6urWjRh8zXXHTtwlFH2ani1vbtKuXDkAjpfNUT6B1s38u3vXk9iOvqrcicCwoK6YV6yQ9O3e7iH8zN1tL'

type FetchInit = { headers?: Record<string, string>; signal?: AbortSignal }

function jsonRes(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function htmlRes(html: string, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    text: async () => html,
    json: async () => ({}),
  }
}

/** Minimal RSC-shaped HTML wrapper: Next.js self.__next_f.push chunk. */
function rscHtml(payload: string): string {
  const escaped = JSON.stringify(payload).slice(1, -1)
  return `<html><script>self.__next_f.push([1,"${escaped}"])</script></html>`
}

function walletRscBlock(address: string, name: string, evm: string | null): string {
  return (
    `{"wallet_address":"${address}","name":"${name}",` +
    `"twitter":null,"telegram":null,` +
    `"evm_address":${evm === null ? 'null' : `"${evm}"`},` +
    `"pfp":"https://img.kolscan.io/${address}","transactions":[`
  )
}

function txRscBlock(signature: string, address: string, solChange: number, kolName: string): string {
  return (
    `{"signature":"${signature}","wallet_address":"${address}",` +
    `"timestamp":1700000000,"sol_change":${solChange},` +
    `"out_token_symbol":"MOON","out_token_address":"${MINT_X}","out_amount":1000,` +
    `"in_token_symbol":"SOL","in_token_address":"${SOL_MINT}","in_amount":${solChange},` +
    `"dex":"Raydium","name":"${kolName}","pfp":"https://img.kolscan.io/x"}`
  )
}

// ─────────────────────────────────────────────────────────────
// A) End-to-end feed pipeline
// ─────────────────────────────────────────────────────────────

describe('end-to-end feed pipeline', () => {
  let fetchMock: Mock<(url: string, init?: FetchInit) => Promise<unknown>>

  beforeEach(() => {
    delete process.env.KOLSCAN_SESSION
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.KOLSCAN_SESSION
  })

  it('merges keyless and HTML feeds, dedupes transactions across legs, and computes usdValue from solPrice', async () => {
    const supaWallets = [
      {
        wallet_address: WALLET_A,
        name: 'AlphaTrader',
        twitter: 'alphatrader',
        telegram: 't_alpha',
        evm_address: null, // Public Supabase table has no EVM address
        pfp: 'https://cdn.example.com/pfp_a.png',
      },
      {
        wallet_address: WALLET_B,
        name: 'BetaKOL',
        twitter: null,
        telegram: null,
        evm_address: null,
        pfp: null,
      },
    ]

    const supaTxs = [
      {
        signature: SIG_SHARED,
        wallet_address: WALLET_A,
        name: 'AlphaTrader',
        timestamp: 1700000000,
        sol_change: 3.0,
        out_token_symbol: 'MOON',
        out_token_address: MINT_X,
        out_amount: 50000,
        in_token_symbol: 'SOL',
        in_token_address: SOL_MINT,
        in_amount: 3.0,
        dex: 'Raydium',
        usd_change: 99999, // Should be ignored; usdValue is solChange * solPrice
      },
      {
        signature: SIG_KEYLESS,
        wallet_address: WALLET_B,
        name: 'BetaKOL',
        timestamp: 1700000010,
        sol_change: 5.0,
        out_token_symbol: 'STAR',
        out_token_address: MINT_X,
        out_amount: 80000,
        in_token_symbol: null,
        in_token_address: null,
        in_amount: 0,
        dex: 'Pump.fun',
        usd_change: 88888,
      },
    ]

    // HTML RSC payload: overlays evmAddress on WALLET_A, carries duplicate SIG_SHARED, plus unique SIG_HTML
    const htmlContent = rscHtml(
      walletRscBlock(WALLET_A, 'AlphaTrader', EVM_A) +
        txRscBlock(SIG_SHARED, WALLET_A, 3.0, 'AlphaTrader') +
        txRscBlock(SIG_HTML, WALLET_A, 2.0, 'AlphaTrader'),
    )

    const SOL_PRICE = 200

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/rest/v1/wallets')) return jsonRes(supaWallets)
      if (url.includes('/rest/v1/transactions_realtime')) return jsonRes(supaTxs)
      if (url.includes('kolscan.io')) return htmlRes(htmlContent)
      if (url.includes('lite-api.jup.ag')) {
        return jsonRes({ [SOL_MINT]: { usdPrice: SOL_PRICE } })
      }
      throw new Error(`Unhandled fetch url: ${url}`)
    })

    const { fetchKolscanFeed } = await import('../index')
    const feed = await fetchKolscanFeed()

    // 1. Wallets merged: base from keyless + evmAddress overlay from HTML
    expect(feed.wallets).toHaveLength(2)
    const walletA = feed.wallets.find((w) => w.address === WALLET_A)
    expect(walletA).toBeDefined()
    expect(walletA?.name).toBe('AlphaTrader')
    expect(walletA?.twitter).toBe('alphatrader')
    expect(walletA?.telegram).toBe('t_alpha')
    expect(walletA?.pfp).toBe('https://cdn.example.com/pfp_a.png')
    expect(walletA?.evmAddress).toBe(EVM_A) // enriched from HTML RSC overlay

    const walletB = feed.wallets.find((w) => w.address === WALLET_B)
    expect(walletB).toBeDefined()
    expect(walletB?.evmAddress).toBeNull()

    // 2. Transactions deduped by signature across keyless + HTML legs (SIG_SHARED appears once, keyless wins)
    expect(feed.transactions).toHaveLength(3)
    const sigs = feed.transactions.map((t) => t.signature)
    expect(sigs).toEqual([SIG_SHARED, SIG_KEYLESS, SIG_HTML])

    // 3. usdValue is strictly solChange * solPrice (never any api usd_change field)
    const txShared = feed.transactions.find((t) => t.signature === SIG_SHARED)
    expect(txShared?.solChange).toBe(3.0)
    expect(txShared?.usdValue).toBe(3.0 * SOL_PRICE) // 600, NOT 99999
    expect(txShared?.usdValue).not.toBe(99999)

    const txKeyless = feed.transactions.find((t) => t.signature === SIG_KEYLESS)
    expect(txKeyless?.solChange).toBe(5.0)
    expect(txKeyless?.usdValue).toBe(5.0 * SOL_PRICE) // 1000, NOT 88888
    expect(txKeyless?.usdValue).not.toBe(88888)

    const txHtml = feed.transactions.find((t) => t.signature === SIG_HTML)
    expect(txHtml?.solChange).toBe(2.0)
    expect(txHtml?.usdValue).toBe(2.0 * SOL_PRICE) // 400

    expect(Number.isNaN(Date.parse(feed.fetchedAt))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// B) Concurrent-run idempotency
// ─────────────────────────────────────────────────────────────

describe('concurrent-run idempotency', () => {
  let tempDir: string | null = null
  let tempSeenPath: string | null = null

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kolscan-itest-seen-'))
    tempSeenPath = join(tempDir, 'kolscan-seen.json')
    process.env.KOLSCAN_SEEN_PATH = tempSeenPath
    process.env.SNIPER_SEEN_DB = 'off' // Keep tests hermetic, avoid live Prisma DB
  })

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = null
      tempSeenPath = null
    }
    delete process.env.KOLSCAN_SEEN_PATH
    delete process.env.SNIPER_SEEN_DB
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('filters unseen txs, marks them seen, and returns 0 unseen on identical second pass', async () => {
    const screenedTxs: KolscanScreenedTx[] = [
      {
        signature: SIG_SHARED,
        walletAddress: WALLET_A,
        kolName: 'AlphaTrader',
        timestamp: 1700000000,
        solChange: 3.0,
        outTokenSymbol: 'MOON',
        outTokenAddress: MINT_X,
        outAmount: 50000,
        inTokenSymbol: 'SOL',
        inTokenAddress: SOL_MINT,
        inAmount: 3.0,
        dex: 'Raydium',
        usdValue: 600,
        screenReason: 'purchase $600 >= $500, winrate 70% >= 60%',
      },
      {
        signature: SIG_KEYLESS,
        walletAddress: WALLET_B,
        kolName: 'BetaKOL',
        timestamp: 1700000010,
        solChange: 5.0,
        outTokenSymbol: 'STAR',
        outTokenAddress: MINT_X,
        outAmount: 80000,
        inTokenSymbol: null,
        inTokenAddress: null,
        inAmount: 0,
        dex: 'Pump.fun',
        usdValue: 1000,
        screenReason: 'purchase $1000 >= $500, winrate 80% >= 60%',
      },
      {
        signature: SIG_HTML,
        walletAddress: WALLET_A,
        kolName: 'AlphaTrader',
        timestamp: 1700000020,
        solChange: 2.0,
        outTokenSymbol: 'SUN',
        outTokenAddress: MINT_X,
        outAmount: 20000,
        inTokenSymbol: 'SOL',
        inTokenAddress: SOL_MINT,
        inAmount: 2.0,
        dex: 'Raydium',
        usdValue: 400,
        screenReason: 'purchase $400 >= $400, winrate 70% >= 60%',
      },
    ]

    // 1. First pass: all N transactions are unseen
    const unseen1 = await filterUnseenTransactionsDb(screenedTxs)
    expect(unseen1).toHaveLength(3)

    // Mark them as seen
    await markTransactionsSeenDb(unseen1)

    // 2. Second pass with the SAME input: 0 unseen
    const unseen2 = await filterUnseenTransactionsDb(screenedTxs)
    expect(unseen2).toHaveLength(0)
  })

  it('calling markTransactionsSeenDb twice with same signatures does not throw and does not duplicate', async () => {
    const items = [{ signature: SIG_SHARED }, { signature: SIG_KEYLESS }]

    // Call first time
    await expect(markTransactionsSeenDb(items)).resolves.not.toThrow()

    // Call second time with identical signatures
    await expect(markTransactionsSeenDb(items)).resolves.not.toThrow()

    // File content check: signatures are not duplicated in the record
    const content = JSON.parse(readFileSync(tempSeenPath!, 'utf8')) as Record<string, number>
    expect(Object.keys(content)).toHaveLength(2)
    expect(typeof content[SIG_SHARED]).toBe('number')
    expect(typeof content[SIG_KEYLESS]).toBe('number')

    // Also handles concurrent marks without collision
    await Promise.all([
      markTransactionsSeenDb(items),
      markTransactionsSeenDb(items),
      markTransactionsSeenDb([{ signature: SIG_HTML }]),
    ])

    const updated = JSON.parse(readFileSync(tempSeenPath!, 'utf8')) as Record<string, number>
    expect(Object.keys(updated)).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────────────────────
// C) Edge cases
// ─────────────────────────────────────────────────────────────

describe('edge cases', () => {
  let fetchMock: Mock<(url: string, init?: FetchInit) => Promise<unknown>>

  beforeEach(() => {
    delete process.env.KOLSCAN_SESSION
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.KOLSCAN_SESSION
  })

  it('returns empty wallets/transactions and does not throw when both keyless legs and HTML are empty', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/rest/v1/wallets')) return jsonRes([])
      if (url.includes('/rest/v1/transactions_realtime')) return jsonRes([])
      if (url.includes('kolscan.io')) return htmlRes(rscHtml('[]'))
      if (url.includes('lite-api.jup.ag')) {
        return jsonRes({ [SOL_MINT]: { usdPrice: 150 } })
      }
      throw new Error(`Unhandled fetch url: ${url}`)
    })

    const { fetchKolscanFeed } = await import('../index')
    const feed = await fetchKolscanFeed()

    expect(feed.wallets).toEqual([])
    expect(feed.transactions).toEqual([])
    expect(Number.isNaN(Date.parse(feed.fetchedAt))).toBe(false)
  })

  it('skips malformed transactions_realtime rows missing signature, wallet_address, or numeric timestamp', async () => {
    const malformedRows = [
      // Missing signature
      {
        wallet_address: WALLET_A,
        timestamp: 1700000000,
        sol_change: 1.0,
      },
      // Empty signature
      {
        signature: '',
        wallet_address: WALLET_A,
        timestamp: 1700000000,
        sol_change: 1.0,
      },
      // Missing wallet_address
      {
        signature: SIG_SHARED,
        timestamp: 1700000000,
        sol_change: 1.0,
      },
      // Empty wallet_address
      {
        signature: SIG_SHARED,
        wallet_address: '',
        timestamp: 1700000000,
        sol_change: 1.0,
      },
      // Missing timestamp
      {
        signature: SIG_SHARED,
        wallet_address: WALLET_A,
        sol_change: 1.0,
      },
      // String timestamp (non-numeric)
      {
        signature: SIG_SHARED,
        wallet_address: WALLET_A,
        timestamp: '1700000000',
        sol_change: 1.0,
      },
      // Null timestamp
      {
        signature: SIG_SHARED,
        wallet_address: WALLET_A,
        timestamp: null,
        sol_change: 1.0,
      },
      // Fully valid row
      {
        signature: SIG_KEYLESS,
        wallet_address: WALLET_B,
        name: 'BetaKOL',
        timestamp: 1700000000,
        sol_change: 2.5,
        out_token_symbol: 'TOK',
        out_token_address: MINT_X,
        out_amount: 1000,
        in_token_symbol: 'SOL',
        in_token_address: SOL_MINT,
        in_amount: 2.5,
        dex: 'Raydium',
      },
    ]

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/rest/v1/wallets')) return jsonRes([])
      if (url.includes('/rest/v1/transactions_realtime')) return jsonRes(malformedRows)
      if (url.includes('kolscan.io')) return htmlRes(rscHtml('[]'))
      if (url.includes('lite-api.jup.ag')) {
        return jsonRes({ [SOL_MINT]: { usdPrice: 100 } })
      }
      throw new Error(`Unhandled fetch url: ${url}`)
    })

    const { fetchKolscanTxsKeyless, fetchKolscanFeed } = await import('../index')

    // Test the helper directly
    const helperTxs = await fetchKolscanTxsKeyless()
    expect(helperTxs).toHaveLength(1)
    expect(helperTxs[0].signature).toBe(SIG_KEYLESS)
    expect(helperTxs[0].walletAddress).toBe(WALLET_B)

    // Test through full feed pipeline
    const feed = await fetchKolscanFeed()
    expect(feed.transactions).toHaveLength(1)
    expect(feed.transactions[0].signature).toBe(SIG_KEYLESS)
    expect(feed.transactions[0].usdValue).toBe(2.5 * 100)
  })

  it('handles HTTP 429 from Supabase by returning [] from the helpers and not throwing', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/rest/v1/')) {
        return jsonRes({ code: '429', message: 'Too Many Requests' }, false, 429)
      }
      if (url.includes('kolscan.io')) return htmlRes('Rate limited', false, 429)
      if (url.includes('lite-api.jup.ag')) {
        return jsonRes({ [SOL_MINT]: { usdPrice: 150 } })
      }
      throw new Error(`Unhandled fetch url: ${url}`)
    })

    const { fetchKolscanWalletsKeyless, fetchKolscanTxsKeyless, fetchKolscanFeed } = await import(
      '../index'
    )

    // Helper functions return [] on 429 and do not throw
    const wallets = await fetchKolscanWalletsKeyless()
    expect(wallets).toEqual([])

    const txs = await fetchKolscanTxsKeyless()
    expect(txs).toEqual([])

    // Full feed pipeline also survives 429 without throwing
    const feed = await fetchKolscanFeed()
    expect(feed.wallets).toEqual([])
    expect(feed.transactions).toEqual([])
    expect(Number.isNaN(Date.parse(feed.fetchedAt))).toBe(false)
  })
})
