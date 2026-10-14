import { describe, expect, it } from 'vitest'
import {
  ACCUMULATION_DEFAULTS,
  buildAccumulationEvents,
  dedupeEventsByContract,
  renderAccumulationAlert,
  shouldSend,
  type AccumulationEvent,
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

function whaleStatus(status = 'WHALE'): Map<string, { status: string; alias: string | null }> {
  return new Map([[WHALE, { status, alias: 'Kang Rug' }]])
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

  it('excludes a candidate with no bullish-classified buyer (random wallet is not a whale)', () => {
    const out = buildAccumulationEvents({
      candidates: [candidate({ buyers: [RANDOM], discoveredBy: RANDOM })],
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
  })

  it('keeps only bullish buyers and aggregates totalBuyUsd from the candidate', () => {
    const status = new Map([
      [WHALE, { status: 'WHALE', alias: null }],
      [SMART, { status: 'QUALIFIED_SMART_MONEY', alias: 'Smart One' }],
      [RANDOM, { status: 'WATCHLIST', alias: null }],
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
    const status = new Map([
      [WHALE, { status: 'WHALE', alias: 'Wugi', winRate: 0.78, pnl: 1.42 }],
    ])
    const ev = buildAccumulationEvents({
      candidates: [candidate()],
      buyerStatus: status,
      market: market(145_200, 38_500),
    })[0]
    const text = renderAccumulationAlert(ev)
    expect(text).toContain('• <b>Wugi</b> [WHALE · WR 78% · PnL +142%]')
    expect(text).toContain('$145.2K')
    expect(text).toContain('$38.5K')
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
    const status = new Map(buyers.map((a) => [a, { status: 'WHALE', alias: `W${a}` }]))
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
