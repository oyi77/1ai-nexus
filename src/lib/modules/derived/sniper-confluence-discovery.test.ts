import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readConfluenceArtifact,
  writeConfluenceArtifact,
  type ConfluenceArtifactSignal,
} from './confluence-state'
import {
  discoverCombined,
  discoverConfluenceCandidates,
  runSniperScan,
} from './sniper-scan'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'

let dir = ''
let run = 0

beforeEach(() => {
  run++
  dir = mkdtempSync(join(tmpdir(), `sniper-confluence-test-${run}-`))
  process.env.CONFLUENCE_LATEST_PATH = join(dir, 'confluence-latest.json')
  process.env.CONFLUENCE_MAX_AGE_MIN = '120'
  process.env.SNIPER_SEEN_PATH = join(dir, 'seen.json')
  process.env.SNIPER_SEEN_DB = 'off'
  process.env.CONFLUENCE_PREFETCH_DB = 'off'
  process.env.CALL_FEED_DB = 'off'
  process.env.WALLET_BUYS_DB = 'off'
  // The call-feed / auto unions read the wallet-buys artifact. Without
  // isolating its PATH the live data/wallet-buys-latest.json leaks real
  // candidates into the union and the count assertions break.
  process.env.WALLET_BUYS_PATH = join(dir, 'wallet-buys-latest.json')
  // whale-buy-scanner (whale-buy-store.ts) is a SECOND store with its own
  // env; without this the loader reads the live DB and injects rows into
  // auto/call-feed wallet unions, breaking candidate-count assertions.
  process.env.WHALE_BUYS_PATH = join(dir, 'whale-buys-latest.json')
  process.env.WHALE_BUYS_DB = 'off'
  process.env.SNIPER_MIN_LIQUIDITY_USD = '0'
})

afterEach(() => {
  delete process.env.CONFLUENCE_LATEST_PATH
  delete process.env.CONFLUENCE_MAX_AGE_MIN
  delete process.env.SNIPER_SEEN_PATH
  delete process.env.SNIPER_SEEN_DB
  delete process.env.CONFLUENCE_PREFETCH_DB
  delete process.env.CALL_FEED_DB
  delete process.env.WALLET_BUYS_DB
  delete process.env.WALLET_BUYS_PATH
  delete process.env.WHALE_BUYS_PATH
  delete process.env.WHALE_BUYS_DB
  delete process.env.SNIPER_MIN_MARKET_CAP_USD
  delete process.env.SNIPER_MIN_LIQUIDITY_USD
  delete process.env.SNIPER_DISCOVER_MODE
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const NOW = Date.now()
const MINT_1 = 'HzPRXMeo6JLQj7dKH79fNnpApNzY8VBQ8g4Ne9Cwpump'
const MINT_2 = 'EocB8TSsZN4N7FhbsZg9d9gX6tLtXM8eXiooDW2Npump'

function sampleSignal(overrides: Partial<ConfluenceArtifactSignal> = {}): ConfluenceArtifactSignal {
  return {
    contract: MINT_1,
    chain: 'solana',
    buyers: ['BuyerAddr111111111111111111111111111111111', 'BuyerAddr222222222222222222222222222222222'],
    totalBuyUsd: 1250,
    firstBuyAt: NOW - 10 * 60_000,
    lastBuyAt: NOW - 2 * 60_000,
    ...overrides,
  }
}

function mockDexscreenerHydration(perContract: Record<string, { symbol?: string; priceUsd?: string; volume5m?: number }> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : String(input)
    if (url.includes('solpump') || url.includes('trenches')) {
      return new Response(JSON.stringify({ data: [], pairs: [] }), { status: 200 })
    }
    // GeckoTerminal serves the OHLCV/price legs of discovery. Left unmocked
    // it reaches the live network, so real tokens enter the union and the
    // "exactly one candidate" assertions fail on any machine with internet.
    if (url.includes('geckoterminal')) {
      return new Response(
        JSON.stringify({ data: { attributes: { base_token_price_usd: '0.01' } } }),
        { status: 200 },
      )
    }
    if (url.includes('api.dexscreener.com') === false && url.includes('dexscreener') === false) {
      // Any other outbound host (coin listings, solana RPC) must not be hit.
      return new Response(JSON.stringify({ data: [], pairs: [], result: [] }), { status: 200 })
    }
    const contract = url.split('/latest/dex/tokens/')[1]
    if (!contract || !perContract[contract]) {
      // Default live pair for any contract if not explicitly null
      if (perContract[contract] === null) {
        return new Response(JSON.stringify({ pairs: [] }), { status: 200 })
      }
      return new Response(
        JSON.stringify({
          pairs: [
            {
              chainId: 'solana',
              pairCreatedAt: NOW - 15 * 60_000,
              marketCap: 250_000,
              priceUsd: '0.005',
              priceChange: { h24: 10 },
              volume: { h24: 100_000, m5: 5_000 },
              baseToken: { symbol: `T_${contract.slice(0, 4)}`, name: contract },
              liquidity: { usd: 40_000 },
            },
          ],
        }),
        { status: 200 },
      )
    }

    const cfg = perContract[contract]
    return new Response(
      JSON.stringify({
        pairs: [
          {
            chainId: 'solana',
            pairCreatedAt: NOW - 15 * 60_000,
            marketCap: 500_000,
            priceUsd: cfg.priceUsd ?? '0.01',
            priceChange: { h24: 15 },
            volume: { h24: 200_000, m5: cfg.volume5m ?? 10_000 },
            baseToken: { symbol: cfg.symbol ?? 'TOKEN', name: contract },
            liquidity: { usd: 60_000 },
          },
        ],
      }),
      { status: 200 },
    )
  })
}

const CLEAN_AUDIT: MemeRiskAudit = {
  id: 'audit-1',
  platform: 'rugcheck',
  chain: 'solana',
  contract: '',
  symbol: '',
  name: '',
  riskLevel: 0,
  riskLabel: 'safe',
  buyTax: 0,
  sellTax: 0,
  top10HolderPercent: 0.15,
  lpLockedPercent: 1,
  canFreeze: false,
  canMint: false,
  isHoneypot: false,
  riskCounts: { high: 0, middle: 0, low: 0 },
  distribution: {
    devPercent: 0,
    sniperPercent: 0,
    bundlerPercent: 0,
    insiderPercent: 0,
  },
  topWallets: [],
  top5AvgPnlPercent: 20,
  auditedAt: Date.now(),
}

describe('confluence artifact persistence (confluence-state.ts)', () => {
  it('reads empty array when artifact file does not exist', async () => {
    const signals = await readConfluenceArtifact()
    expect(signals).toEqual([])
  })

  it('reads empty array when artifact file is corrupted JSON', async () => {
    writeFileSync(process.env.CONFLUENCE_LATEST_PATH as string, '{ malformed: json ...')
    const signals = await readConfluenceArtifact()
    expect(signals).toEqual([])
  })

  it('reads empty array when artifact is stale (>120 min by default)', async () => {
    const staleTime = new Date(NOW - 150 * 60_000).toISOString()
    writeConfluenceArtifact([sampleSignal()], { generatedAt: staleTime })
    const signals = await readConfluenceArtifact()
    expect(signals).toEqual([])
  })

  it('reads fresh artifact with valid signals', async () => {
    const sig = sampleSignal({ contract: MINT_1, totalBuyUsd: 3400 })
    writeConfluenceArtifact([sig])
    const signals = await readConfluenceArtifact()
    expect(signals).toHaveLength(1)
    expect(signals[0].contract).toBe(MINT_1)
    expect(signals[0].totalBuyUsd).toBe(3400)
    expect(signals[0].buyers).toHaveLength(2)
  })

  it('supports explicit path and options overload', async () => {
    const customPath = join(dir, 'custom-confluence.json')
    writeConfluenceArtifact([sampleSignal()], { filePath: customPath, windowMin: 30 })
    const signals = await readConfluenceArtifact(customPath)
    expect(signals).toHaveLength(1)

    const staleRead = await readConfluenceArtifact({
      filePath: customPath,
      maxAgeMin: 5,
      nowMs: NOW + 10 * 60_000,
    })
    expect(staleRead).toEqual([])
  })

  it('maps ConfluenceSignal tokenMint/qualifiedBuyers to contract/buyers', () => {
    const res = writeConfluenceArtifact([
      {
        tokenMint: MINT_2,
        windowStart: NOW - 15 * 60_000,
        windowEnd: NOW,
        qualifiedBuyers: ['AddrA', 'AddrB', 'AddrC'],
        totalBuyUsd: 5600,
        firstBuyAt: NOW - 14 * 60_000,
        lastBuyAt: NOW - 1 * 60_000,
      },
    ])
    expect(res.signals).toHaveLength(1)
    expect(res.signals[0].contract).toBe(MINT_2)
    expect(res.signals[0].buyers).toEqual(['AddrA', 'AddrB', 'AddrC'])
    expect(res.signals[0].totalBuyUsd).toBe(5600)
  })
})

describe('discoverConfluenceCandidates (sniper-scan.ts)', () => {
  it('returns empty array when no artifact is available', async () => {
    mockDexscreenerHydration()
    const candidates = await discoverConfluenceCandidates(5)
    expect(candidates).toEqual([])
  })

  it('hydrates valid confluence signals into SniperEnrichedToken with provenance and evidence', async () => {
    mockDexscreenerHydration({
      [MINT_1]: { symbol: 'ALPHA', priceUsd: '0.02', volume5m: 12_000 },
    })

    writeConfluenceArtifact([
      sampleSignal({
        contract: MINT_1,
        buyers: ['WalletA', 'WalletB', 'WalletC'],
        totalBuyUsd: 4500,
      }),
    ])

    const candidates = await discoverConfluenceCandidates(5)
    expect(candidates).toHaveLength(1)
    const token = candidates[0]

    expect(token.contract).toBe(MINT_1)
    expect(token.symbol).toBe('ALPHA')
    expect(token.id).toBe(`confluence:${MINT_1}`)

    // Provenance requirement
    expect(token.provenance).toEqual({
      sourceType: 'operator-feed',
      provider: 'smart-money-confluence',
      note: 'confluence: 3 qualified buyers',
    })

    // Discovery evidence requirement
    expect(token.discoveryEvidence).toHaveLength(1)
    const ev = token.discoveryEvidence?.[0]
    expect(ev?.provider).toBe('smart-money-confluence')
    expect(ev?.category).toBe('WHALE_ACTIVITY')
    expect(ev?.confluence).toBe(3)
    expect(ev?.note).toContain('confluence: 3 qualified buyers')
  })

  it('skips invalid non-base58 contract addresses', async () => {
    mockDexscreenerHydration()
    writeConfluenceArtifact([
      sampleSignal({ contract: 'invalid_short_contract' }),
      sampleSignal({ contract: '0x1234567890123456789012345678901234567890' }), // EVM-like
    ])

    const candidates = await discoverConfluenceCandidates(5)
    expect(candidates).toEqual([])
  })

  it('skips unlisted pairs without throwing when Dexscreener returns no pair', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ pairs: [] }), { status: 200 })
    })

    writeConfluenceArtifact([sampleSignal({ contract: MINT_1 })])
    const candidates = await discoverConfluenceCandidates(5)
    expect(candidates).toEqual([])
  })

  it('respects the limit argument', async () => {
    mockDexscreenerHydration()
    writeConfluenceArtifact([
      sampleSignal({ contract: MINT_1 }),
      sampleSignal({ contract: MINT_2 }),
    ])

    const candidates = await discoverConfluenceCandidates(1)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].contract).toBe(MINT_1)
  })
})

describe('discoverCombined integration with confluence', () => {
  it('discovers confluence candidates via discoverCombined when SNIPER_DISCOVER_MODE=confluence', async () => {
    process.env.SNIPER_DISCOVER_MODE = 'confluence'
    mockDexscreenerHydration({
      [MINT_1]: { symbol: 'CONF_ONLY', priceUsd: '0.05' },
    })
    writeConfluenceArtifact([sampleSignal({ contract: MINT_1 })])

    const candidates = await discoverCombined(5)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].contract).toBe(MINT_1)
    expect(candidates[0].provenance?.provider).toBe('smart-money-confluence')
  })

  it('prioritizes confluence candidates alongside wallet buys in auto mode', async () => {
    process.env.SNIPER_DISCOVER_MODE = 'auto'
    mockDexscreenerHydration({
      [MINT_1]: { symbol: 'WHALE_CONF', priceUsd: '0.05' },
    })
    writeConfluenceArtifact([sampleSignal({ contract: MINT_1 })])

    const candidates = await discoverCombined(5)
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    expect(candidates[0].contract).toBe(MINT_1)
  })

  it('includes confluence candidates in call-feed mode when the artifact exists', async () => {
    process.env.SNIPER_DISCOVER_MODE = 'call-feed'
    // Empty call feed: no feed rows, so the call-feed branch must still pick
    // up fresh confluence signals (the A2 landmine: call-feed mode never
    // read the confluence artifact, leaving confluence-cron output dead).
    process.env.CALL_FEED_PATH = join(dir, 'call-feed.json')
    process.env.CALL_FEED_MAX_AGE_MIN = '999999'
    mockDexscreenerHydration({
      [MINT_1]: { symbol: 'CONF_FEED', priceUsd: '0.05' },
    })
    writeConfluenceArtifact([sampleSignal({ contract: MINT_1 })])

    const candidates = await discoverCombined(5)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].contract).toBe(MINT_1)
    expect(candidates[0].provenance?.provider).toBe('smart-money-confluence')

    delete process.env.CALL_FEED_PATH
    delete process.env.CALL_FEED_MAX_AGE_MIN
  })

  it('runs runSniperScan end-to-end with confluence candidates', async () => {
    process.env.SNIPER_DISCOVER_MODE = 'confluence'
    mockDexscreenerHydration({
      [MINT_1]: { symbol: 'CONF_SCAN', priceUsd: '0.05' },
    })
    writeConfluenceArtifact([sampleSignal({ contract: MINT_1 })])

    const deliver = vi.fn(async () => true)
    const scan = await runSniperScan(
      { deliver: false },
      {
        discover: discoverCombined,
        audit: async (_chain, contract) => [{ ...CLEAN_AUDIT, contract }],
        deliver,
      },
    )

    expect(scan.scanned).toBe(1)
    expect(scan.decisions[0].contract).toBe(MINT_1)
  })

  it('gracefully falls back to API discovery when confluence artifact is stale', async () => {
    process.env.SNIPER_DISCOVER_MODE = 'auto'
    const staleTime = new Date(NOW - 180 * 60_000).toISOString()
    writeConfluenceArtifact([sampleSignal({ contract: MINT_1 })], { generatedAt: staleTime })

    // Dexscreener mock returns pair for boosts/fresh api
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('token-boosts')) {
        return new Response(JSON.stringify([{ chainId: 'solana', tokenAddress: MINT_2 }]), { status: 200 })
      }
      if (url.includes('/tokens/v1/')) {
        return new Response(
          JSON.stringify([
            {
              chainId: 'solana',
              pairCreatedAt: NOW - 5 * 60_000,
              marketCap: 300_000,
              priceUsd: '0.01',
              priceChange: { h24: 12 },
              volume: { h24: 150_000, m5: 8_000 },
              baseToken: { symbol: 'BOOST_PAIR', name: 'Boosted Pair' },
              liquidity: { usd: 50_000 },
            },
          ]),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    })

    const candidates = await discoverCombined(5)
    // Stale confluence was not picked up; API discovery took over
    const confCandidate = candidates.find((c) => c.contract === MINT_1)
    expect(confCandidate).toBeUndefined()
  })
})
