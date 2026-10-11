// ─────────────────────────────────────────────────────────────
// Signal tier tests — policy A–F ordering, delivery gating, labels.
// Pure; no I/O.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  classifySignalTier,
  shouldDeliver,
  tierLabel,
  DEFAULT_DELIVERY_POLICY,
  type TierInput,
} from './signal-tier';
import type { SniperDecision } from './meme-sniper';
import type { SmartMoneyEvidence } from './smart-money-provider';

function decision(over: Partial<SniperDecision> = {}): SniperDecision {
  return {
    status: 'SIGNAL',
    rationale: 'clean',
    rejections: [],
    warnings: [],
    metrics: {
      stage: 'new-pair',
      ageMinutes: 10,
      ageLabel: '10m',
      stageLabel: 'New Pair',
      volMcRatio: 3,
      requiredRatio: 2,
      devPercent: 0,
      sniperPercent: 2,
      bundlerPercent: 5,
      insiderPercent: 1,
      top10Percent: 20,
      clusterPercent: null,
      avgPnlPercent: null,
      pnlAssessment: 'neutral',
    },
    alert: 'alert',
    ...over,
  };
}

function evidence(over: Partial<SmartMoneyEvidence> = {}): SmartMoneyEvidence {
  return {
    contract: 'MintA',
    chain: 'solana',
    buyers: [
      {
        walletId: 'w1',
        address: 'Addr1',
        alias: null,
        status: 'QUALIFIED_SMART_MONEY',
        pnl30d: 1.2,
        winRate: 0.7,
        sampleCount: 20,
        classifiedAt: new Date(),
        holdingUsd: 5000,
        stale: false,
      },
    ],
    walletsHolding: 1,
    byStatus: { QUALIFIED_SMART_MONEY: 1 },
    strongest: 'QUALIFIED_SMART_MONEY',
    bullishHoldingUsd: 5000,
    ttlMs: 1000,
    source: 'wallet-db:smartMoneyWallet',
    ...over,
  };
}

const BASE: TierInput = {
  decision: decision(),
  smartMoney: evidence(),
  ageMinutes: 10,
  staleAfterMinutes: 120,
  dataComplete: true,
};

describe('classifySignalTier', () => {
  it('HIGH_CONVICTION when screen clean + fresh + confirmed + complete', () => {
    const r = classifySignalTier(BASE);
    expect(r.tier).toBe('HIGH_CONVICTION');
    expect(r.deliverableAsTopSignal).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('security failure outranks a bullish wallet (policy C)', () => {
    const r = classifySignalTier({
      ...BASE,
      decision: decision({ status: 'REJECT', rejections: ['mint authority still active'] }),
    });
    expect(r.tier).toBe('REJECT');
    expect(r.deliverableAsTopSignal).toBe(false);
  });

  it('narrative/momentum never rescue a security failure', () => {
    const r = classifySignalTier({
      ...BASE,
      decision: decision({ status: 'REJECT', rejections: ['LP not burnt (0% < 100%)'] }),
    });
    expect(r.tier).toBe('REJECT');
  });

  it('STALE when older than the freshness window', () => {
    const r = classifySignalTier({ ...BASE, ageMinutes: 500, staleAfterMinutes: 120 });
    expect(r.tier).toBe('STALE');
    expect(r.deliverableAsTopSignal).toBe(false);
  });

  it('CANDIDATE when screening passed but no wallet confirmation', () => {
    const r = classifySignalTier({ ...BASE, smartMoney: evidence({ buyers: [], strongest: null, byStatus: {} }) });
    expect(r.tier).toBe('CANDIDATE');
    expect(r.deliverableAsTopSignal).toBe(false);
    expect(r.deliverableAsWatchlist).toBe(true);
  });

  it('CANDIDATE when coverage incomplete despite confirmation', () => {
    const r = classifySignalTier({ ...BASE, dataComplete: false });
    expect(r.tier).toBe('CANDIDATE');
    expect(r.missing).toContain('source coverage incomplete');
  });

  it('UNKNOWN when wallet evidence is unreadable (absence != safety)', () => {
    const r = classifySignalTier({ ...BASE, smartMoney: null });
    expect(r.tier).toBe('UNKNOWN');
    expect(r.deliverableAsTopSignal).toBe(false);
    expect(r.deliverableAsWatchlist).toBe(false);
  });

  it('stale-classified buyers do not confirm (no buyers in evidence)', () => {
    const r = classifySignalTier({ ...BASE, smartMoney: evidence({ buyers: [], strongest: null, walletsHolding: 3 }) });
    expect(r.tier).toBe('CANDIDATE');
  });

  it('WATCHLIST when screening itself is only watch-level', () => {
    const r = classifySignalTier({
      ...BASE,
      decision: decision({ status: 'WATCHLIST' }),
      smartMoney: evidence({ buyers: [], strongest: null }),
    });
    expect(r.tier).toBe('WATCHLIST');
    expect(r.deliverableAsTopSignal).toBe(false);
  });
});

describe('shouldDeliver', () => {
  it('delivers only HIGH_CONVICTION under the default policy', () => {
    expect(shouldDeliver('HIGH_CONVICTION')).toBe(true);
    expect(shouldDeliver('CANDIDATE')).toBe(false);
    expect(shouldDeliver('WATCHLIST')).toBe(false);
    expect(shouldDeliver('UNKNOWN')).toBe(false);
    expect(shouldDeliver('STALE')).toBe(false);
    expect(shouldDeliver('REJECT')).toBe(false);
  });

  it('never delivers UNKNOWN/STALE/REJECT even with watchlist enabled', () => {
    const p = { allowTopSignal: true, allowWatchlist: true };
    expect(shouldDeliver('UNKNOWN', p)).toBe(false);
    expect(shouldDeliver('STALE', p)).toBe(false);
    expect(shouldDeliver('REJECT', p)).toBe(false);
    expect(shouldDeliver('WATCHLIST', p)).toBe(true);
  });

  it('default policy keeps watchlist opt-in', () => {
    expect(DEFAULT_DELIVERY_POLICY.allowWatchlist).toBe(false);
  });
});

describe('tierLabel', () => {
  it('marks non-top tiers so they cannot be mistaken for a top signal', () => {
    expect(tierLabel('CANDIDATE')).toContain('not a top signal');
    expect(tierLabel('WATCHLIST')).toContain('not a top signal');
    expect(tierLabel('HIGH_CONVICTION')).not.toContain('not a top signal');
  });
});
