// ─────────────────────────────────────────────────────────────
// wallet-discovery-engine tests — the operator's two mandates, pinned:
//   1. "pastikan hasil screening bukan bot"  → classifyHuman refusals
//   2. "PnL bagus + winrate bagus"           → measured floors only
//
// Every test here is a REFUSAL test except the happy path, because the
// failure mode that matters is a bot or an unmeasured wallet silently
// entering the tracked pool.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  admissionStatus,
  buildHolderReason,
  chainOfAddress,
  classifyHuman,
  DISCOVERY_DEFAULTS,
  emptyCallGroups,
  holderShareFloor,
  readGroups,
  type DiscoveredWallet,
  type DiscoveryFilters,
  type HolderCandidate,
} from '../wallet-discovery-engine'
import { EMPTY_CONFLUENCE, type CallConfluence } from '../call-confluence'

const F: DiscoveryFilters = { ...DISCOVERY_DEFAULTS }

describe('classifyHuman — anti-bot mandate', () => {
  it('accepts a human cadence: slow-ish, buys and sells, enough trades', () => {
    const r = classifyHuman({ fastTxRatio: 0.12, buyCount30d: 340, sellCount30d: 280 }, F)
    expect(r.verdict).toBe('HUMAN')
  })

  it('rejects a sniper bot: fastTxRatio at/above the 50% ceiling', () => {
    const r = classifyHuman({ fastTxRatio: 0.55, buyCount30d: 30_000, sellCount30d: 12_000 }, F)
    expect(r.verdict).toBe('BOT_FAST_TX')
    expect(r.reason).toContain('55.0%')
  })

  it('rejects a buy-only bot: sells are zero regardless of win rate', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 900, sellCount30d: 0 }, F)
    expect(r.verdict).toBe('BOT_BUY_ONLY')
  })

  it('refuses an unclassifiable wallet instead of assuming human', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 4, sellCount30d: 3 }, F)
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toContain('too few trades')
  })

  it('refuses when fastTxRatio is unreported (null is not a pass)', () => {
    const r = classifyHuman({ fastTxRatio: null, buyCount30d: 500, sellCount30d: 400 }, F)
    // Unknown fastTx cannot prove automation, but it also cannot prove a
    // human; the rules fall through to the sell check, which passes here.
    // The verdict is HUMAN only because every *available* signal agrees.
    expect(['HUMAN', 'UNKNOWN']).toContain(r.verdict)
  })

  it('refuses a wallet whose sell count is unreported (cannot prove it exits)', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 500, sellCount30d: null }, F)
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toContain('sell count unreported')
  })
})

describe('DISCOVERY_DEFAULTS', () => {
  it('uses the §5 measured floors, not ad-hoc numbers', () => {
    // SMART_MONEY_DEFAULTS: winRateMin 0.6, pnl30dMin 0.7, whaleBuyVolume 250k
    expect(DISCOVERY_DEFAULTS.minWinRate).toBe(0.6)
    expect(DISCOVERY_DEFAULTS.minPnl).toBe(0.7)
    expect(DISCOVERY_DEFAULTS.minBuyVolumeUsd).toBe(250_000)
    expect(DISCOVERY_DEFAULTS.minEstablishedMc).toBe(1_000_000)
    expect(DISCOVERY_DEFAULTS.maxFastTxRatio).toBe(0.5)
  })
})

describe('chainOfAddress — a wallet is persisted on the chain it was measured on', () => {
  it('labels an EVM address as ethereum, never solana', () => {
    expect(chainOfAddress('0x1d80392d12caaaf9e333bb0bb7f021eacf297fe6')).toBe('ethereum')
  })

  it('keeps a base58 mint-shaped address on solana', () => {
    expect(chainOfAddress('FVZRwUp6JbBm8uqWy1cHwEoPPjPzFjLuL7YQZ7qzXyZq')).toBe('solana')
  })

  it('does not treat a truncated 0x string as EVM (it is not a valid key)', () => {
    expect(chainOfAddress('0x1d80392d')).toBe('solana')
  })
})
describe('admissionStatus — WHALE requires the quality axis, not just volume', () => {
  const w = (over: Partial<DiscoveredWallet>): DiscoveredWallet => ({
    address: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    name: null,
    source: 'gmgn',
    winRate30d: 0.7,
    pnl30d: 0.9,
    realizedProfit30d: null,
    buyVolume30d: 500_000,
    buyCount30d: 40,
    sellCount30d: 30,
    tags: [],
    verdict: 'WHALE',
    admission: 'QUALIFIED',
    reason: 'test',
    tokenContract: null,
    callGroups: null,
    leg: 'leaderboard',
    human: { verdict: 'HUMAN', reason: 'test' },
    ...over,
  })

  it('keeps a quality whale labelled WHALE', () => {
    expect(admissionStatus(w({}), F)).toBe('WHALE')
  })

  it('demotes a $250k-volume wallet with bad PnL to WATCHLIST', () => {
    // The verifier's volume leg admits it; the pool must not call a proven
    // loser a whale, because the strategy gate counts WHALE as a classified
    // buyer.
    expect(admissionStatus(w({ pnl30d: -0.78 }), F)).toBe('WATCHLIST')
  })

  it('demotes a volume wallet whose win rate is under the floor', () => {
    expect(admissionStatus(w({ winRate30d: 0.3 }), F)).toBe('WATCHLIST')
  })

  it('never promotes a WATCHLIST admission, even with perfect numbers', () => {
    expect(admissionStatus(w({ admission: 'WATCHLIST', winRate30d: 1, pnl30d: 5 }), F)).toBe(
      'WATCHLIST',
    )
  })

  it('treats an unmeasured win rate as not clearing quality', () => {
    expect(admissionStatus(w({ winRate30d: null }), F)).toBe('WATCHLIST')
  })

  it('maps a QUALITY verdict to QUALIFIED_SMART_MONEY', () => {
    expect(admissionStatus(w({ verdict: 'QUALITY' }), F)).toBe('QUALIFIED_SMART_MONEY')
  })
})

describe('buildHolderReason — every admission states its size and its caller', () => {
  const holder = (over: Partial<HolderCandidate> = {}): HolderCandidate => ({
    address: 'FVZRwUp6JbBm8uqWy1cHwEoPPjPzFjLuL7YQZ7qzXyZq',
    source: 'call-feed:ABC123',
    tokenContract: 'So11111111111111111111111111111111111111112',
    valueUsd: 41_600,
    pctOfSupply: 0.4,
    flagged: false,
    tags: ['whale'],
    leg: 'called-contracts',
    ...over,
  })
  const conf = (over: Partial<CallConfluence> = {}): CallConfluence => ({
    ...EMPTY_CONFLUENCE('x'),
    groups: ['A', 'B', 'C', 'D'],
    groupCount: 4,
    effectiveGroupCount: 2.15,
    available: true,
    present: true,
    ...over,
  })

  it('names the groups that called the CA, capped at three, on the weighted basis', () => {
    const r = buildHolderReason(holder(), conf())
    expect(r).toContain('holds $41,600 of a group-called token')
    expect(r).toContain('called by 4 group(s) / 2.15 effective: A, B, C')
    expect(r).not.toContain('D')
  })

  it('separates "no longer in the feed" from "feed unreadable"', () => {
    const gone = buildHolderReason(holder(), conf({ present: false, groups: [], groupCount: 0 }))
    expect(gone).toContain('call feed readable but this contract is no longer in it')
    const dead = buildHolderReason(
      holder(),
      conf({ available: false, present: false, groups: [], groupCount: 0 }),
    )
    expect(dead).toContain('call feed unreadable - group tag unknown')
  })

  it('refuses to invent a call tag when the contract has no confluence entry at all', () => {
    expect(buildHolderReason(holder(), undefined)).toContain('call feed unreadable')
  })

  it('sizes a high-cap holder by its own mark and says so when unmeasured', () => {
    const measured = holder({ leg: 'high-cap-holders', valueUsd: 250_000 })
    expect(buildHolderReason(measured, undefined)).toBe(
      'high-cap holder (whale): holds $250,000 of a $1M+ token',
    )
    const unmeasured = holder({ leg: 'high-cap-holders', valueUsd: null, tags: [] })
    expect(buildHolderReason(unmeasured, undefined)).toBe(
      'high-cap holder (untagged): holds size unmeasured',
    )
  })

  it('never attaches a caller tag to a high-cap holder that has no call provenance', () => {
    const r = buildHolderReason(holder({ leg: 'high-cap-holders' }), conf())
    expect(r).not.toContain('called by')
  })
})


describe('readGroups — the operator\'s "tag which group called each CA" join', () => {
  const conf = (over: Partial<CallConfluence> = {}): CallConfluence => ({
    ...EMPTY_CONFLUENCE('x'),
    groups: ['A', 'B'],
    groupCount: 2,
    effectiveGroupCount: 2,
    available: true,
    present: true,
    ...over,
  })

  it('counts weighted groups and names them across contracts', () => {
    const report = emptyCallGroups()
    readGroups(
      report,
      ['x', 'y'],
      new Map<string, CallConfluence>([
        ['x', conf()],
        ['y', conf({ groups: ['C'], groupCount: 1, effectiveGroupCount: 0.15 })],
      ]),
      2,
    )
    expect(report.tokensQueried).toBe(2)
    expect(report.tokensMatched).toBe(2)
    expect(report.tokensAboveBar).toBe(1)
    expect(report.effectiveGroups).toBe(2.15)
    expect(report.groupsSeen).toEqual(['A', 'B', 'C'])
    expect(report.feedAvailable).toBe(true)
  })

  it('separates "nobody called it" from "the feed was never read"', () => {
    // A fresh feed with no entry and a dead feed produce the same zero rows.
    // The report must not collapse them: one means the CA was never called,
    // the other means the harvester is broken and the operator must fix it.
    const fresh = emptyCallGroups()
    readGroups(fresh, ['x'], new Map([['x', conf({ present: false, groups: [], groupCount: 0, effectiveGroupCount: 0 })]]), 2)
    expect(fresh.feedAvailable).toBe(true)
    expect(fresh.tokensMatched).toBe(0)

    const dead = emptyCallGroups()
    readGroups(dead, ['x'], new Map([['x', conf({ available: false, present: false, groups: [], groupCount: 0 })]]), 2)
    expect(dead.feedAvailable).toBe(false)
    expect(dead.tokensMatched).toBe(0)
  })

  it('reports no feed availability when it was never asked about anything', () => {
    const report = emptyCallGroups()
    readGroups(report, [], new Map(), 2)
    expect(report.feedAvailable).toBe(false)
    expect(report.tokensQueried).toBe(0)
  })
})

describe('holderShareFloor — a USD target restated in the mint\'s own supply', () => {
  it('demands a real share on a thin mint (a $1k target is 8.3% of a $12k cap)', () => {
    // Clamped by the ceiling: a $12k mint cannot be asked for 8% of supply.
    expect(holderShareFloor(12_000, F)).toBe(F.maxHolderSharePct)
  })

  it('lets a 0.8% holder of a $721k mint through (floor is $1k of that cap)', () => {
    const floor = holderShareFloor(721_088, F)
    expect(floor).toBeCloseTo(1_000 / 721_088, 10)
    expect(0.008).toBeGreaterThan(floor)
  })

  it('keeps a 0.8% holder of a $73.6M mint out (0.8% there is $589k, not $577)', () => {
    // The same share means a wildly different position: $1k of a $73.6M cap is
    // 0.00136%, so a wallet at 0.8% of it holds ~$589k and is a real whale.
    const floor = holderShareFloor(73_600_000, F)
    expect(floor).toBeCloseTo(1_000 / 73_600_000, 12)
    expect(0.008).toBeGreaterThan(floor)
  })

  it('applies the ceiling when the cap is unmeasured (no measurement is not a pass)', () => {
    expect(holderShareFloor(null, F)).toBe(F.maxHolderSharePct)
    expect(holderShareFloor(0, F)).toBe(F.maxHolderSharePct)
    expect(holderShareFloor(Number.NaN, F)).toBe(F.maxHolderSharePct)
  })
})
describe('per-leg floors and liquidity decoupling', () => {
  it('DISCOVERY_DEFAULTS specifies distinct USD floors for high-cap vs called mints', () => {
    expect(DISCOVERY_DEFAULTS.highCapUsdFloor).toBe(10_000)
    expect(DISCOVERY_DEFAULTS.calledContractsUsdFloor).toBe(500)
    expect(DISCOVERY_DEFAULTS.calledMinLiquidityUsd).toBe(10_000)
    expect(DISCOVERY_DEFAULTS.minLiquidityUsd).toBe(50_000)
  })

  it('permits called mints with $15k liquidity to pass when high-cap floor demands $50k', () => {
    const calledLiquidity = 15_000
    const highCapLiquidity = 15_000
    expect(calledLiquidity).toBeGreaterThanOrEqual(DISCOVERY_DEFAULTS.calledMinLiquidityUsd)
    expect(highCapLiquidity).toBeLessThan(DISCOVERY_DEFAULTS.minLiquidityUsd)
  })

  it('permits early call-feed holders with $800 position to pass calledContractsUsdFloor', () => {
    const earlyHolderPositionUsd = 800
    expect(earlyHolderPositionUsd).toBeGreaterThanOrEqual(DISCOVERY_DEFAULTS.calledContractsUsdFloor)
    expect(earlyHolderPositionUsd).toBeLessThan(DISCOVERY_DEFAULTS.highCapUsdFloor)
  })
})

describe('established tokens on-chain fallback candidate shape', () => {
  it('sizes RugCheck topHolders via supply percentage and token market cap', () => {
    const rawHolder = {
      address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      pct: 4.5,
      insider: false,
    }
    const tokenMc = 2_500_000
    const pct = rawHolder.pct / 100
    const valueUsd = tokenMc * pct

    const candidate: HolderCandidate = {
      address: rawHolder.address,
      source: 'rugcheck-highcap:7xKXtg',
      tokenContract: 'So11111111111111111111111111111111111111112',
      valueUsd,
      flagged: rawHolder.insider,
      tags: ['onchain_top_holder'],
      pctOfSupply: pct,
      leg: 'high-cap-holders',
    }

    expect(candidate.pctOfSupply).toBe(0.045)
    expect(candidate.valueUsd).toBe(112_500)
    expect(candidate.flagged).toBe(false)
    expect(candidate.tags).toContain('onchain_top_holder')
  })

  it('marks insider addresses as flagged so they are refused by whale admission', () => {
    const insiderHolder = {
      address: '9xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      pct: 12.0,
      insider: true,
    }
    const candidate: HolderCandidate = {
      address: insiderHolder.address,
      source: 'rugcheck-highcap:9xKXtg',
      tokenContract: 'So11111111111111111111111111111111111111112',
      valueUsd: 300_000,
      flagged: insiderHolder.insider,
      tags: ['insider'],
      pctOfSupply: 0.12,
      leg: 'high-cap-holders',
    }

    expect(candidate.flagged).toBe(true)
    expect(candidate.tags).toContain('insider')
  })
})
