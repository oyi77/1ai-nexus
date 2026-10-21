// Contract tests: call-feed weighted confluence wiring.
//
// scripts/call-feed.py (3d352af) emits weighted_score + caller_weights per
// candidate. The TS pipeline must (a) carry both into the candidate's
// discovery evidence, (b) use weighted_score ONLY as a ranking tie-breaker —
// never as a gate, never defaulting a number when the field is absent
// (older artifacts stay valid), and (c) never crash on absent caller_weights.
//
// discoverCallFeed is module-private, so these tests drive it through
// runSniperScan in call-feed mode with CALL_FEED_PATH pointing at fixtures
// and globalThis.fetch mocked for the dexscreener hydration leg.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSniperScan, type SniperScanResult } from './sniper-scan'

let dir = ''

let run = 0
beforeEach(() => {
  run++
  dir = mkdtempSync(join(tmpdir(), `sniper-callfeed-${run}-`))
  process.env.SNIPER_SEEN_PATH = join(dir, 'seen.json')
  process.env.SNIPER_SEEN_DB = 'off'
  process.env.CALL_FEED_DB = 'off'
  process.env.CALL_FEED_PATH = join(dir, 'call-feed.json')
  process.env.CALL_FEED_MAX_AGE_MIN = '999999'
  // call-feed mode also unions confluence + wallet buys (A2 fix), so both
  // artifacts must be isolated from the repo's live data/ files.
  process.env.CONFLUENCE_LATEST_PATH = join(dir, 'confluence-latest.json')
  process.env.CONFLUENCE_PREFETCH_DB = 'off'
  process.env.WALLET_BUYS_PATH = join(dir, 'wallet-buys-latest.json')
  process.env.WALLET_BUYS_DB = 'off'
  // whale-buy-scanner is a SECOND store (whale-buy-store.ts) with its own
  // env names; without this the loader reads the live DB and injects its
  // rows into the union, breaking every scanned-count assertion.
  process.env.WHALE_BUYS_PATH = join(dir, 'whale-buys-latest.json')
  process.env.WHALE_BUYS_DB = 'off'
  process.env.SNIPER_DISCOVER_MODE = 'call-feed'
  // DEFAULT_DELIVERY_POLICY reads this lazily; delete so ambient .env cannot leak.
  delete process.env.SNIPER_DELIVER_WATCHLIST
})

afterEach(() => {
  delete process.env.SNIPER_SEEN_PATH
  delete process.env.SNIPER_SEEN_DB
  delete process.env.CALL_FEED_DB
  delete process.env.CALL_FEED_PATH
  delete process.env.CALL_FEED_MAX_AGE_MIN
  delete process.env.SNIPER_DISCOVER_MODE
  delete process.env.CONFLUENCE_LATEST_PATH
  delete process.env.CONFLUENCE_PREFETCH_DB
  delete process.env.WALLET_BUYS_PATH
  delete process.env.WALLET_BUYS_DB
  delete process.env.WHALE_BUYS_PATH
  delete process.env.WHALE_BUYS_DB
  delete process.env.SNIPER_MIN_MARKET_CAP_USD
  delete process.env.SNIPER_MIN_LIQUIDITY_USD
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const NOW = Date.now()

// Realistic-length mints — discoverCallFeed's base58 guard (32-44 chars
// ending 'pump', or an 0x EVM address) drops short strings like 'AAApump'.
const MINT_A = 'HzPRXMeo6JLQj7dKH79fNnpApNzY8VBQ8g4Ne9Cwpump'
const MINT_B = 'EocB8TSsZN4N7FhbsZg9d9gX6tLtXM8eXiooDW2Npump'
const MINT_C = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsUpump'
const MINT_D = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1vpump'

function artifactRow(
  contract: string,
  over: {
    weighted_score?: number
    caller_weights?: Record<string, number>
    source_count?: number
    createdAt?: number
    volume5m?: number
  } = {},
) {
  return {
    contract,
    chain: 'solana',
    source_count: over.source_count ?? 2,
    mentions: 4,
    kinds: ['kol'],
    sources: ['chanA', 'chanB'],
    first_seen: new Date(NOW - 30 * 60_000).toISOString(),
    last_seen: new Date(NOW - 5 * 60_000).toISOString(),
    ...(over.weighted_score !== undefined && { weighted_score: over.weighted_score }),
    ...(over.caller_weights !== undefined && { caller_weights: over.caller_weights }),
  }
}

function writeArtifact(candidates: unknown[]) {
  writeFileSync(
    process.env.CALL_FEED_PATH as string,
    JSON.stringify({ generated_at: new Date().toISOString(), window_min: 60, candidates }),
  )
}

/**
 * Mock dexscreener hydration: each contract gets a fresh, moving pair with
 * a UNIQUE symbol (a shared ticker would trigger copycat collapse before
 * the ranking these tests assert on).
 */
function mockHydration(perContract: Record<string, { createdAt?: number; volume5m?: number }> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : String(input)
    const contract = url.split('/latest/dex/tokens/')[1]
    if (!contract) return new Response(JSON.stringify({}), { status: 404 })
    const over = perContract[contract] ?? {}
    return new Response(
      JSON.stringify({
        pairs: [
          {
            chainId: 'solana',
            pairCreatedAt: over.createdAt ?? NOW - 10 * 60_000,
            marketCap: 1_000_000,
            priceUsd: '0.001',
            priceChange: { h24: 5 },
            volume: { h24: 500_000, m5: over.volume5m ?? 2_000_000 },
            baseToken: { symbol: `T${contract.slice(0, 6)}`, name: contract },
            liquidity: { usd: 50_000 },
          },
        ],
      }),
      { status: 200 },
    )
  })
}

function evidenceFor(res: SniperScanResult, contract: string) {
  const d = res.decisions.find((x) => x.contract === contract)
  return d?.discoveryEvidence.find((e) => e.provider === 'call-feed')
}

describe('call-feed weighted confluence', () => {
  it('parses weighted_score and caller_weights into the candidate evidence', async () => {
    writeArtifact([
      artifactRow(MINT_A, {
        weighted_score: 9.5,
        caller_weights: { chanA: 4.5, chanB: 5 },
      }),
    ])
    mockHydration()
    const res = await runSniperScan({})
    expect(res.scanned).toBe(1)
    const ev = evidenceFor(res, MINT_A)
    expect(ev?.weightedScore).toBe(9.5)
    expect(ev?.callerWeights).toEqual({ chanA: 4.5, chanB: 5 })
  })

  it('leaves weighted fields undefined when an older artifact omits them', async () => {
    // Fixture WITHOUT the new fields — the backward-compat contract.
    writeArtifact([artifactRow(MINT_B)])
    mockHydration()
    const res = await runSniperScan({})
    expect(res.scanned).toBe(1) // still a candidate, not dropped
    const ev = evidenceFor(res, MINT_B)
    expect(ev?.weightedScore).toBeUndefined()
    expect(ev?.callerWeights).toBeUndefined()
  })

  it('never invents a default: malformed weighted_score stays absent', async () => {
    writeArtifact([{ ...artifactRow(MINT_C), weighted_score: 'high' }])
    mockHydration()
    const res = await runSniperScan({})
    const ev = evidenceFor(res, MINT_C)
    expect(ev?.weightedScore).toBeUndefined()
  })

  it('does not crash when caller_weights is absent while weighted_score is present', async () => {
    writeArtifact([artifactRow(MINT_D, { weighted_score: 7 })])
    mockHydration()
    const res = await runSniperScan({})
    expect(res.scanned).toBe(1)
    const ev = evidenceFor(res, MINT_D)
    expect(ev?.weightedScore).toBe(7)
    expect(ev?.callerWeights).toBeUndefined()
  })

  it('weighted_score reorders only equal-age, equal-flow candidates', async () => {
    writeArtifact([
      // Same pair age and same 5m flow → weighted_score is the tie-breaker.
      artifactRow(MINT_C, { weighted_score: 1, createdAt: NOW - 10 * 60_000, volume5m: 2_000_000 }),
      artifactRow(MINT_A, { weighted_score: 9, createdAt: NOW - 10 * 60_000, volume5m: 2_000_000 }),
    ])
    mockHydration({
      [MINT_C]: { createdAt: NOW - 10 * 60_000, volume5m: 2_000_000 },
      [MINT_A]: { createdAt: NOW - 10 * 60_000, volume5m: 2_000_000 },
    })
    const res = await runSniperScan({})
    expect(res.scanned).toBe(2)
    const first = res.decisions.find((d) => d.contract === MINT_A)
    const second = res.decisions.find((d) => d.contract === MINT_C)
    expect(first && second).toBeTruthy()
    // Decisions are pushed in candidate order — MINT_A (weighted 9) was first.
    expect(res.decisions.indexOf(first!)).toBeLessThan(res.decisions.indexOf(second!))
  })

  it('weight never outranks freshness: a fresher pair stays first', async () => {
    writeArtifact([
      artifactRow(MINT_A, { weighted_score: 99, createdAt: NOW - 60 * 60_000, volume5m: 2_000_000 }),
      artifactRow(MINT_B, { weighted_score: 0.5, createdAt: NOW - 2 * 60_000, volume5m: 2_000_000 }),
    ])
    mockHydration({
      [MINT_A]: { createdAt: NOW - 60 * 60_000, volume5m: 2_000_000 },
      [MINT_B]: { createdAt: NOW - 2 * 60_000, volume5m: 2_000_000 },
    })
    const res = await runSniperScan({})
    const heavy = res.decisions.find((d) => d.contract === MINT_A)
    const light = res.decisions.find((d) => d.contract === MINT_B)
    expect(light && heavy).toBeTruthy()
    expect(res.decisions.indexOf(light!)).toBeLessThan(res.decisions.indexOf(heavy!))
  })
})
