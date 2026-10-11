// ─────────────────────────────────────────────────────────────
// Smart-money gate unit tests (pure, no DB).
//
// The gate exists to confirm a QUALIFIED classification, not any holder
// with a green number. The wallet-tracer emits TRACER_PNL rows (single
// token, sampleCount 1) for provenance — those must never confirm.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  BULLISH_STATUSES,
  TRACER_PNL_STATUS,
  evaluateSmartMoneyGate,
  type SmartMoneyEvidence,
  type WalletBuyer,
} from './smart-money-provider'

function buyer(over: Partial<WalletBuyer>): WalletBuyer {
  return {
    walletId: 'w1',
    address: 'addr',
    alias: null,
    status: null,
    pnl30d: null,
    winRate: null,
    sampleCount: 0,
    classifiedAt: new Date(),
    holdingUsd: null,
    stale: false,
    ...over,
  }
}

function evidence(buyers: WalletBuyer[], walletsHolding = buyers.length): SmartMoneyEvidence {
  const byStatus: Record<string, number> = {}
  for (const b of buyers) {
    if (b.status != null) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1
  }
  return {
    contract: 'c',
    chain: 'solana',
    buyers,
    walletsHolding,
    byStatus,
    strongest: BULLISH_STATUSES.find((s) => (byStatus[s] ?? 0) > 0) ?? null,
    bullishHoldingUsd: null,
    ttlMs: 0,
    source: 'test',
  }
}

describe('evaluateSmartMoneyGate', () => {
  it('passes on a classifier-confirmed buyer', () => {
    const g = evaluateSmartMoneyGate(evidence([buyer({ status: 'QUALIFIED_SMART_MONEY', sampleCount: 20 })]))
    expect(g.verdict).toBe('pass')
    expect(g.strongest).toBe('QUALIFIED_SMART_MONEY')
    expect(g.bullishCount).toBe(1)
  })

  it('never confirms a tracer-only single-token PnL row', () => {
    // Pre-fix this passed: buyers.length counted the TRACER_PNL label.
    const g = evaluateSmartMoneyGate(
      evidence([buyer({ status: TRACER_PNL_STATUS, pnl30d: 0.34, sampleCount: 1 })], 12),
    )
    expect(g.verdict).toBe('warn')
    expect(g.strongest).toBeNull()
    expect(g.bullishCount).toBe(0)
  })

  it('never confirms a PROVISIONAL thin sample', () => {
    const g = evaluateSmartMoneyGate(evidence([buyer({ status: 'PROVISIONAL', sampleCount: 12 })]))
    expect(g.verdict).toBe('warn')
    expect(g.bullishCount).toBe(0)
  })

  it('reports the strongest confirmed status when labels are mixed', () => {
    const g = evaluateSmartMoneyGate(
      evidence([
        buyer({ status: TRACER_PNL_STATUS, sampleCount: 1 }),
        buyer({ walletId: 'w2', status: 'WHALE', sampleCount: 30 }),
      ]),
    )
    expect(g.verdict).toBe('pass')
    expect(g.strongest).toBe('WHALE')
    expect(g.bullishCount).toBe(1)
  })
})
