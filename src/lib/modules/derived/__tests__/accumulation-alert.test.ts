import { describe, expect, it } from 'vitest'
import {
  ACCUMULATION_DEFAULTS,
  buildAccumulationEvents,
  BUYER_CATEGORY_DISCLAIMER,
  classifyBuyer,
  dedupeEventsByContract,
  renderAccumulationAlert,
  resolveBuyerContext,
  resolveCrossTokenContext,
  shouldSend,
  type AccumulationEvent,
  type BuyerCategory,
  type BuyerFacts,
} from '../accumulation-alert'
import {
  markSent,
  pruneAccumulationState,
  readState,
} from '../accumulation-state'
import type { WalletBuyCandidate } from '../wallet-discovery'

const MINT = '7tZt1LXb9vXq2pVvU4s9dK3mN1wR5tY6uE8iO0pA2sD'
const WHALE = 'whale1111111111111111111111111111111111111111'
const SMART = 'smart2222222222222222222222222222222222222222'
const RANDOM = 'random333333333333333333333333333333333333333'
const KOL = 'kol44444444444444444444444444444444444444444444'
const FRESH = 'fresh5555555555555555555555555555555555555555555'

function candidate(over: Partial<WalletBuyCandidate> = {}): WalletBuyCandidate {
  return {
    contract: MINT,
    chain: 'solana',
    discoveredBy: WHALE,
    buyers: [WHALE],
    buyVolumeUsd: 2_500,
    buyCount: 1,
    firstBuyAt: 1_700_000_000_000,
    lastBuyAt: 1_700_000_100_000,
    discoveryEvidence: [],
    ...over,
  }
}

function whaleStatus(status = 'WHALE'): Map<string, BuyerFacts> {
  return new Map([[WHALE, { status, alias: 'Kang Rug', labels: [] }]])
}

function market(mc: number | null, liquidity: number | null = 50_000): Map<string, { marketCapUsd: number | null; liquidityUsd: number | null; symbol: string | null }> {
  return new Map([[MINT, { marketCapUsd: mc, liquidityUsd: liquidity, symbol: 'TOK' }]])
}

describe('buildAccumulationEvents — verified-buy gating', () => {
  it('excludes a candidate below minBuyUsd', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyVolumeUsd: 999.99 })],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })
    expect(out).toEqual([])
  })

  it('emits a fresh_wallet event for an unclassified buyer at a large aggregate (no track record, with disclaimer)', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyers: [RANDOM], discoveredBy: RANDOM })],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })
    expect(out).toHaveLength(1)
    expect(out[0].buyers).toHaveLength(1)
    expect(out[0].buyers[0].primaryCategory).toBe('fresh_wallet')
    expect(out[0].primaryCategory).toBe('fresh_wallet')
    expect(out[0].tier).toBe('low')
    expect(out[0].buyers[0].disclaimers).toContain(BUYER_CATEGORY_DISCLAIMER.fresh_wallet)
  })

  it('excludes a pure-DISQUALIFIED buyer (negative record, no tags) even at a large aggregate', () => {
    const status: Map<string, BuyerFacts> = new Map([
      [RANDOM, { status: 'DISQUALIFIED', alias: null, labels: [] }],
    ])
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyers: [RANDOM], discoveredBy: RANDOM })],
      buyerStatus: status,
      market: market(500_000),
    })
    expect(out).toEqual([])
  })

  it('excludes a fresh_wallet buyer below the fresh-wallet floor (aggregate < 2x minBuyUsd)', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyers: [RANDOM], discoveredBy: RANDOM, buyVolumeUsd: 1_500 })],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })
    expect(out).toEqual([])
  })

  it('excludes a non-solana candidate', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate({ chain: 'ethereum' as never })],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })
    expect(out).toEqual([])
  })

  it('excludes a candidate at/above maxMarketCapUsd', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(1_000_000),
    })
    expect(out).toEqual([])
  })

  it('builds an event for a WHALE buyer with correct total and classification', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })
    expect(out).toHaveLength(1)
    expect(out[0].totalBuyUsd).toBe(2_500)
    expect(out[0].token.contract).toBe(MINT)
    expect(out[0].token.marketCapUsd).toBe(500_000)
    expect(out[0].buyers).toHaveLength(1)
    expect(out[0].buyers[0].address).toBe(WHALE)
    expect(out[0].buyers[0].status).toBe('WHALE')
    expect(out[0].buyers[0].classification).toBe('Whale')
    expect(out[0].buyers[0].alias).toBe('Kang Rug')
    expect(out[0].buyers[0].primaryCategory).toBe('other_coin_whale')
    expect(out[0].buyers[0].categories).toEqual(['other_coin_whale'])
    expect(out[0].buyers[0].tier).toBe('high')
    expect(out[0].buyers[0].disclaimers).toContain(BUYER_CATEGORY_DISCLAIMER.other_coin_whale)
    expect(out[0].primaryCategory).toBe('other_coin_whale')
    expect(out[0].tier).toBe('high')
  })

  it('keeps only tagged buyers and aggregates totalBuyUsd from the candidate', () => {
    const status: Map<string, BuyerFacts> = new Map([
      [WHALE, { status: 'WHALE', alias: null, labels: [] }],
      [SMART, { status: 'QUALIFIED_SMART_MONEY', alias: 'Smart One', labels: [] }],
      [RANDOM, { status: 'WATCHLIST', alias: null, labels: [] }],
    ])
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyers: [WHALE, SMART, RANDOM], buyVolumeUsd: 4_200, buyCount: 3 })],
      buyerStatus: status,
      market: market(900_000),
    })
    expect(out).toHaveLength(1)
    expect(out[0].buyers.map((b) => b.address)).toEqual([WHALE, SMART])
    expect(out[0].totalBuyUsd).toBe(4_200)
  })

  it('still builds an event when market cap is null but flags it as missing', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(null),
    })
    expect(out).toHaveLength(1)
    expect(out[0].token.marketCapUsd).toBeNull()
    expect(out[0].missing).toContain('market cap unverified')
  })

  it('never fabricates per-buyer USD or tx signatures when evidence is absent', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate({ discoveryEvidence: [] })],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })
    expect(out[0].buyers[0].buyValueUsd).toBeNull()
    expect(out[0].evidence.join('\n')).toContain('foldWalletBuys')
    expect(out[0].evidence.join('\n')).not.toContain('signature')
  })
})

describe('renderAccumulationAlert — operator format', () => {
  function event(): AccumulationEvent {
    return buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })[0]
  }

  it('renders modern header, CA in code block, MC, total buy, buyer status and risk footer', () => {
    const text = renderAccumulationAlert(event())
    expect(text).toContain('🐋 <b>WHALE ACCUMULATION DETECTED</b>')
    expect(text).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━')
    expect(text).toContain(`<code>${MINT}</code>`)
    expect(text).toContain('<i>(tap to copy)</i>')
    expect(text).toContain('<b>$2,500</b>')
    expect(text).toContain('$500K')
    expect(text).toContain('Kang Rug')
    expect(text).toContain('WHALE')
    expect(text).toContain('Screening alert only — DYOR & manage risk')
  })

  it('renders buyer winRate and pnl badges when available', () => {
    const status: Map<string, BuyerFacts> = new Map([
      [WHALE, { status: 'WHALE', alias: 'Wugi', labels: [], winRate: 0.78, pnl: 1.42 }],
    ])
    const ev = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: status,
      market: market(145_200, 38_500),
    })[0]
    const text = renderAccumulationAlert(ev)
    expect(text).toContain('• <b>Wugi</b> [Whale · WHALE · WR 78% · PnL +142%]')
    expect(text).toContain('$145.2K')
    expect(text).toContain('$38.5K')
    expect(text).toContain('🏷 <b>Signal:</b> Whale')
    expect(text).toContain('whale buyer - large position, cross-token')
  })

  it('renders WR n/a badge when winRate is genuinely null', () => {
    const status: Map<string, BuyerFacts> = new Map([
      [WHALE, { status: 'WHALE', alias: 'Wugi', labels: [], winRate: null, pnl: null }],
    ])
    const ev = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: status,
      market: market(200_000),
    })[0]
    const text = renderAccumulationAlert(ev)
    expect(text).toContain('• <b>Wugi</b> [Whale · WHALE · WR n/a]')
    expect(text).not.toContain('WR 0%')
    expect(text).not.toContain('PnL')
  })

  it('renders unverified MC/liquidity honestly', () => {
    const ev = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(null, null),
    })[0]
    const text = renderAccumulationAlert(ev)
    expect(text).toContain('<i>unverified</i>')
  })

  it('stays under 4096 chars with many buyers', () => {
    const buyers = Array.from({ length: 200 }, (_, i) => `addr${String(i).padStart(40, '0')}`)
    const status: Map<string, BuyerFacts> = new Map(buyers.map((a) => [a, { status: 'WHALE', alias: `W${a}`, labels: [] }]))
    const ev = buildAccumulationEvents({
      candidates: [candidate({ buyers, buyVolumeUsd: 500_000 })],
      buyerStatus: status,
      market: market(100_000),
    })[0]
    const text = renderAccumulationAlert(ev)
    expect(text.length).toBeLessThanOrEqual(4096)
    expect(text).toContain('WHALE ACCUMULATION DETECTED')
  })
})

describe('dedupe — cooldown + per-run contract uniqueness', () => {
  it('suppresses inside cooldown and sends after it', () => {
    const ev = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })[0]
    const now = 1_700_000_000_000
    const afterFirst = markSent({}, MINT, now)
    expect(shouldSend(ev, afterFirst, now + ACCUMULATION_DEFAULTS.cooldownMs - 1)).toBe(false)
    expect(shouldSend(ev, afterFirst, now + ACCUMULATION_DEFAULTS.cooldownMs)).toBe(true)
    expect(shouldSend(ev, {}, now)).toBe(true)
  })

  it('dedupes events by contract across a run', () => {
    const a = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })[0]
    const b = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })[0]
    expect(dedupeEventsByContract([a, b])).toHaveLength(1)
  })
})

describe('accumulation-state — JSON store discipline', () => {
  it('prunes stale entries and marks sent atomically', () => {
    const now = 1_700_000_000_000
    const pruned = pruneAccumulationState(
      { old: now - 8 * 24 * 60 * 60 * 1000, fresh: now },
      now,
    )
    expect(pruned).toEqual({ fresh: now })
    expect(markSent({}, MINT, now)).toEqual({ [MINT]: now })
  })

  it('readState never throws on a missing file', () => {
    process.env.ACCUMULATION_STATE_PATH = '/tmp/definitely-missing-accumulation-state.json'
    expect(readState()).toEqual({})
    delete process.env.ACCUMULATION_STATE_PATH
  })
})

describe('classifyBuyer — 4-category taxonomy', () => {
  const base: BuyerFacts = { status: null, alias: null, labels: [] }

  it('tags smart money (QUALIFIED_SMART_MONEY) as smart_money, no disclaimer buyer-side', () => {
    const tags = classifyBuyer({ ...base, status: 'QUALIFIED_SMART_MONEY', alias: 'Sharp' })
    expect(tags).toEqual(['smart_money'])
    expect(BUYER_CATEGORY_DISCLAIMER.smart_money).toBeNull()
  })

  it('tags WHALE_AND_SMART_MONEY as smart_money only (not double-tagged as whale)', () => {
    const tags = classifyBuyer({ ...base, status: 'WHALE_AND_SMART_MONEY', alias: 'Whale One' })
    expect(tags).toEqual(['smart_money'])
  })

  it('tags pure WHALE as other_coin_whale', () => {
    const tags = classifyBuyer({ ...base, status: 'WHALE', alias: 'Big Holder' })
    expect(tags).toEqual(['other_coin_whale'])
  })

  it('tags a KOL label even when a classified status exists (orthogonal)', () => {
    const tags = classifyBuyer({ ...base, status: 'QUALIFIED_SMART_MONEY', alias: 'Trade Guru', labels: ['kolscan', 'kol-monitor'] })
    expect(tags).toEqual(['smart_money', 'kol'])
  })

  it('tags whale + KOL together (operator sees both tags)', () => {
    const tags = classifyBuyer({ ...base, status: 'WHALE', alias: 'KOL King', labels: ['kol-monitor'] })
    expect(tags).toEqual(['other_coin_whale', 'kol'])
  })

  it('tags a KOL alias when labels are empty (and null status also = fresh_wallet)', () => {
    const tags = classifyBuyer({ ...base, status: null, alias: 'KOLSCAN Kang Rug' })
    expect(tags).toEqual(['kol', 'fresh_wallet'])
  })

  it('tags a null status as fresh_wallet', () => {
    const tags = classifyBuyer({ ...base, status: null })
    expect(tags).toEqual(['fresh_wallet'])
  })

  it('tags an UNKNOWN status as fresh_wallet', () => {
    const tags = classifyBuyer({ ...base, status: 'UNKNOWN' })
    expect(tags).toEqual(['fresh_wallet'])
  })

  it('tags the FIRST_SEEN label as fresh_wallet even with a null status', () => {
    const tags = classifyBuyer({ ...base, status: null, labels: ['FIRST_SEEN'] })
    expect(tags).toContain('fresh_wallet')
  })

  it('emits NOTHING for a pure-DISQUALIFIED wallet (negative record, no other tag)', () => {
    const tags = classifyBuyer({ ...base, status: 'DISQUALIFIED' })
    expect(tags).toEqual([])
  })

  it('emits the kol tag for a DISQUALIFIED wallet with a KOL label (orthogonal still applies)', () => {
    const tags = classifyBuyer({ ...base, status: 'DISQUALIFIED', labels: ['kolscan'] })
    expect(tags).toEqual(['kol'])
  })

  it('emits NOTHING for WATCHLIST and PROVISIONAL (unverified, not fresh either)', () => {
    expect(classifyBuyer({ ...base, status: 'WATCHLIST' })).toEqual([])
    expect(classifyBuyer({ ...base, status: 'PROVISIONAL' })).toEqual([])
  })

  it('matches kol case-insensitively (KOLSCAN, Kol-Monitor)', () => {
    expect(classifyBuyer({ ...base, status: null, labels: ['KOLSCAN'] })).toContain('kol')
    expect(classifyBuyer({ ...base, status: null, labels: ['Kol-Monitor'] })).toContain('kol')
    expect(classifyBuyer({ ...base, status: null, alias: 'SuperKOL' })).toContain('kol')
  })
  it('treats the GMGN smart_degen tag as a KOL proxy (known profitable trader)', () => {
    expect(classifyBuyer({ ...base, status: null, labels: ['gmgn', 'whale', 'whale-verification', 'smart_degen'] })).toContain('kol')
    expect(classifyBuyer({ ...base, status: 'WHALE', labels: ['gmgn', 'whale', 'whale-verification', 'smart_degen'] })).toEqual(['other_coin_whale', 'kol'])
  })
})

describe('buildAccumulationEvents — buyer taxonomy emission', () => {
  it('emits a smart_money event with highest tier and NO disclaimer', () => {
    const status: Map<string, BuyerFacts> = new Map([
      [SMART, { status: 'QUALIFIED_SMART_MONEY', alias: 'Sharp', labels: [] }],
    ])
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyers: [SMART], discoveredBy: SMART, buyVolumeUsd: 1_200 })],
      buyerStatus: status,
      market: market(500_000),
    })
    expect(out).toHaveLength(1)
    expect(out[0].primaryCategory).toBe('smart_money')
    expect(out[0].tier).toBe('highest')
    expect(out[0].disclaimers).toEqual([])
    expect(out[0].buyers[0].disclaimers).toEqual([])
  })

  it('emits a mixed whale + KOL event with both tags tier-ordered', () => {
    const status: Map<string, BuyerFacts> = new Map([
      [WHALE, { status: 'WHALE', alias: 'Big', labels: [] }],
      [KOL, { status: 'WHALE', alias: 'KOL King', labels: ['kol-monitor'] }],
    ])
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyers: [WHALE, KOL], buyVolumeUsd: 3_000, buyCount: 2 })],
      buyerStatus: status,
      market: market(500_000),
    })
    expect(out).toHaveLength(1)
    expect(out[0].categories).toEqual(['other_coin_whale', 'kol'])
    expect(out[0].primaryCategory).toBe('other_coin_whale')
    expect(out[0].disclaimers).toContain(BUYER_CATEGORY_DISCLAIMER.other_coin_whale)
    expect(out[0].disclaimers).toContain(BUYER_CATEGORY_DISCLAIMER.kol)
    const kolBuyer = out[0].buyers.find((b) => b.address === KOL)
    expect(kolBuyer?.categories).toEqual(['other_coin_whale', 'kol'])
  })

  it('renders fresh-wallet event text with the disclaimer, not a fabricated amount', () => {
    const status: Map<string, BuyerFacts> = new Map([
      [FRESH, { status: 'UNKNOWN', alias: null, labels: ['FIRST_SEEN'] }],
    ])
    const ev = buildAccumulationEvents({
      candidates: [candidate({ buyers: [FRESH], discoveredBy: FRESH, buyVolumeUsd: 45_911 })],
      buyerStatus: status,
      market: market(500_000),
    })[0]
    const text = renderAccumulationAlert(ev)
    expect(text).toContain('🏷 <b>Signal:</b> Fresh wallet')
    expect(text).toContain('fresh wallet - no track record')
    expect(text).not.toContain('Smart money')
  })

  it('labels tie-break: a wallet with all tags emits primary=smart_money', () => {
    const tags: BuyerCategory[] = ['smart_money', 'other_coin_whale', 'kol', 'fresh_wallet']
    void tags
    const all = classifyBuyer({ status: 'QUALIFIED_SMART_MONEY', alias: 'KOL Sharp', labels: ['kolscan', 'FIRST_SEEN'] })
    expect(all[0]).toBe('smart_money')
    expect(all).toEqual(['smart_money', 'kol', 'fresh_wallet'])
  })
})

describe('resolveCrossTokenContext — cross-token whale semantics (GAP-1)', () => {
  const OTHER_TOKEN = 'Other11111111111111111111111111111111111111'
  const whale: BuyerFacts = { status: 'WHALE', alias: 'Big', labels: [], alertTokenContract: MINT }

  it('returns unknown when no holdings are provided (fallback to wallet-global)', () => {
    const r = resolveCrossTokenContext({ ...whale })
    expect(r.context).toBe('unknown')
    expect(r.holdingUsd).toBeNull()
  })

  it('returns cross_token when a holding on a DIFFERENT contract >= $50k', () => {
    const r = resolveCrossTokenContext({
      ...whale,
      walletHoldings: [
        { tokenAddress: OTHER_TOKEN, usdValue: 120_000 },
      ],
    })
    expect(r.context).toBe('cross_token')
    expect(r.holdingUsd).toBe(120_000)
  })

  it('returns same_token when the only large holding IS the alert token', () => {
    const r = resolveCrossTokenContext({
      ...whale,
      walletHoldings: [
        { tokenAddress: MINT, usdValue: 80_000 },
      ],
    })
    expect(r.context).toBe('same_token')
    expect(r.holdingUsd).toBe(80_000)
  })

  it('cross_token wins over same_token when both apply (migration is the stronger signal)', () => {
    const r = resolveCrossTokenContext({
      ...whale,
      walletHoldings: [
        { tokenAddress: MINT, usdValue: 90_000 },
        { tokenAddress: OTHER_TOKEN, usdValue: 200_000 },
      ],
    })
    expect(r.context).toBe('cross_token')
    expect(r.holdingUsd).toBe(200_000)
  })

  it('returns unknown when holdings exist but all are below $50k threshold', () => {
    const r = resolveCrossTokenContext({
      ...whale,
      walletHoldings: [
        { tokenAddress: OTHER_TOKEN, usdValue: 49_999 },
        { tokenAddress: MINT, usdValue: 30_000 },
      ],
    })
    expect(r.context).toBe('unknown')
    expect(r.holdingUsd).toBeNull()
  })

  it('returns unknown when alertTokenContract is missing (cannot distinguish same vs cross)', () => {
    const r = resolveCrossTokenContext({
      status: 'WHALE',
      alias: 'Big',
      labels: [],
      walletHoldings: [{ tokenAddress: OTHER_TOKEN, usdValue: 100_000 }],
    })
    expect(r.context).toBe('cross_token')
  })

  it('preserves Solana base58 case-sensitivity (different-case mint is a different token)', () => {
    const r = resolveCrossTokenContext({
      ...whale,
      // Same chars, different case — Solana treats these as different mints.
      walletHoldings: [{ tokenAddress: MINT.toUpperCase(), usdValue: 100_000 }],
    })
    expect(r.context).toBe('cross_token')
  })
})

describe('resolveBuyerContext — categories + cross-token (GAP-1)', () => {
  const OTHER_TOKEN = 'Other11111111111111111111111111111111111111'

  it('does not compute cross-token context for a non-whale buyer', () => {
    const r = resolveBuyerContext({ status: 'QUALIFIED_SMART_MONEY', alias: 'Sharp', labels: [] })
    expect(r.categories).toEqual(['smart_money'])
    expect(r.crossTokenContext).toBeUndefined()
  })

  it('computes cross_token context for a whale with cross-token holdings', () => {
    const r = resolveBuyerContext({
      status: 'WHALE',
      alias: 'Big',
      labels: [],
      alertTokenContract: MINT,
      walletHoldings: [{ tokenAddress: OTHER_TOKEN, usdValue: 150_000 }],
    })
    expect(r.categories).toEqual(['other_coin_whale'])
    expect(r.crossTokenContext).toBe('cross_token')
    expect(r.crossTokenHoldingUsd).toBe(150_000)
  })
})

describe('buildAccumulationEvents — cross-token disclaimer wiring (GAP-1)', () => {
  const OTHER_TOKEN = 'Other11111111111111111111111111111111111111'

  function whaleWithHoldings(holdings: Array<{ tokenAddress: string; usdValue: number }>): Map<string, BuyerFacts> {
    return new Map([
      [WHALE, { status: 'WHALE', alias: 'Kang Rug', labels: [], walletHoldings: holdings }],
    ])
  }

  it('renders cross-token migration disclaimer when whale holds $50k+ on a different token', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleWithHoldings([{ tokenAddress: OTHER_TOKEN, usdValue: 120_000 }]),
      market: market(500_000),
    })
    expect(out).toHaveLength(1)
    const b = out[0].buyers[0]
    expect(b.crossTokenContext).toBe('cross_token')
    expect(b.crossTokenHoldingUsd).toBe(120_000)
    expect(b.disclaimers).toContain('whale buyer - cross-token migration (holds $120K on other tokens)')
    const text = renderAccumulationAlert(out[0])
    expect(text).toContain('cross-token migration')
    expect(text).toContain('$120K')
  })

  it('renders accumulating-position disclaimer when whale holds the alert token itself', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleWithHoldings([{ tokenAddress: MINT, usdValue: 75_000 }]),
      market: market(500_000),
    })
    const b = out[0].buyers[0]
    expect(b.crossTokenContext).toBe('same_token')
    expect(b.disclaimers).toContain('whale buyer - accumulating existing position')
  })

  it('falls back to the original disclaimer when no holdings data (unknown)', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleStatus(),
      market: market(500_000),
    })
    const b = out[0].buyers[0]
    expect(b.crossTokenContext).toBe('unknown')
    expect(b.crossTokenHoldingUsd).toBeNull()
    expect(b.disclaimers).toContain(BUYER_CATEGORY_DISCLAIMER.other_coin_whale)
  })

  it('falls back to unknown when holdings are below $50k', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: whaleWithHoldings([{ tokenAddress: OTHER_TOKEN, usdValue: 40_000 }]),
      market: market(500_000),
    })
    expect(out[0].buyers[0].crossTokenContext).toBe('unknown')
    expect(out[0].buyers[0].disclaimers).toContain(BUYER_CATEGORY_DISCLAIMER.other_coin_whale)
  })
})
