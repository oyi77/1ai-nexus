// ─────────────────────────────────────────────────────────────
// Signal tier tests — policy A–F ordering, delivery gating, labels,
// dev-history reputation, and trenches bonding curve formatting.
// Pure; no I/O.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach } from 'vitest';
import {
  classifySignalTier,
  shouldDeliver,
  tierLabel,
  formatTieredSignal,
  formatPotentialCoinSignal,
  DEFAULT_DELIVERY_POLICY,
  type TierInput,
  type SignalFormatInput,
} from '../signal-tier';
import type { SniperDecision, SniperPayload } from '../meme-sniper';
import type { SmartMoneyEvidence } from '../smart-money-provider';
import type { DevHistoryVerdict } from '../dev-history';

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

function payload(over: Partial<SniperPayload> = {}): SniperPayload {
  return {
    ticker: 'TEST',
    contract: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    ageMinutes: 30,
    security: {
      mintable: false,
      freezeAuthority: false,
      honeypot: false,
      lpBurnedPercent: 100,
      lpLockedPercent: null,
    },
    distribution: { top10Percent: 12, devPercent: 0, sniperPercent: 3, bundlerPercent: 2, insiderPercent: 0 },
    momentum: { marketCap: 250_000, volume5m: 60_000 },
    ...over,
  } as SniperPayload;
}

function formatInput(over: Partial<SignalFormatInput> = {}): SignalFormatInput {
  return {
    payload: payload(),
    tier: 'HIGH_CONVICTION',
    tierReasons: [],
    tierMissing: [],
    smartMoney: null,
    marketCapUsd: 250_000,
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
  afterEach(() => {
    delete process.env.SNIPER_DELIVER_WATCHLIST;
  });

  it('delivers only HIGH_CONVICTION under the default policy', () => {
    // The default policy reads SNIPER_DELIVER_WATCHLIST lazily, and the
    // operator's .env sets it to "true". Unset it here so this case asserts
    // the DEFAULT (watchlist off) instead of whatever the environment says.
    delete process.env.SNIPER_DELIVER_WATCHLIST;
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
    delete process.env.SNIPER_DELIVER_WATCHLIST;
    expect(DEFAULT_DELIVERY_POLICY.allowWatchlist).toBe(false);
  });

  it('enables WATCHLIST delivery when SNIPER_DELIVER_WATCHLIST=true', () => {
    process.env.SNIPER_DELIVER_WATCHLIST = 'true';
    // The policy reads the env lazily, so the already-imported const sees it.
    expect(DEFAULT_DELIVERY_POLICY.allowWatchlist).toBe(true);
    expect(shouldDeliver('WATCHLIST')).toBe(true);
    expect(shouldDeliver('CANDIDATE')).toBe(true);
    // HIGH_CONVICTION stays deliverable; junk tiers stay blocked.
    expect(shouldDeliver('HIGH_CONVICTION')).toBe(true);
    expect(shouldDeliver('REJECT')).toBe(false);
    delete process.env.SNIPER_DELIVER_WATCHLIST;
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

describe('formatTieredSignal — devHistory and bondingCurve', () => {
  it('devHistory: CLEAN renders the correct dev history line', () => {
    const devClean: DevHistoryVerdict = {
      tier: 'CLEAN',
      previousTokens: 5,
      matureTokens: 5,
      knownMigrations: 5,
      migrations: 3,
      migrationRate: 0.6,
      ruggedCount: 0,
      reasons: ['3 of 5 tokens migrated, no rugs detected'],
    };
    const out = formatTieredSignal(formatInput({ devHistory: devClean }));
    expect(out.text).toContain('• Dev History: ✅ CLEAN (3/5 migrated)');
  });

  it('devHistory: SERIAL_RUGGER renders serial rugger warning', () => {
    const devRugger: DevHistoryVerdict = {
      tier: 'SERIAL_RUGGER',
      previousTokens: 8,
      matureTokens: 8,
      knownMigrations: 8,
      migrations: 0,
      migrationRate: 0,
      ruggedCount: 4,
      reasons: ['4 tokens rugged'],
    };
    const out = formatTieredSignal(formatInput({ devHistory: devRugger }));
    expect(out.text).toContain('• Dev History: 🚨 SERIAL RUGGER (4 rugged / 8 deployed)');
  });

  it('devHistory: UNPROVEN renders first deploy note', () => {
    const devUnproven: DevHistoryVerdict = {
      tier: 'UNPROVEN',
      previousTokens: 0,
      matureTokens: 0,
      knownMigrations: 0,
      migrations: 0,
      migrationRate: null,
      ruggedCount: 0,
      reasons: ['first deploy'],
    };
    const out = formatTieredSignal(formatInput({ devHistory: devUnproven }));
    expect(out.text).toContain('• Dev History: ℹ️ UNPROVEN (first deploy)');
  });

  it('devHistory: UNPROVEN with deployments but no reported outcome says so', () => {
    const devUnmeasured: DevHistoryVerdict = {
      tier: 'UNPROVEN',
      previousTokens: 3,
      matureTokens: 3,
      knownMigrations: 0,
      migrations: 0,
      migrationRate: null,
      ruggedCount: 0,
      reasons: ['no migration outcome reported'],
    };
    const out = formatTieredSignal(formatInput({ devHistory: devUnmeasured }));
    expect(out.text).toContain(
      '• Dev History: ℹ️ UNPROVEN (3 deployed, none had a reported migration outcome)',
    );
    expect(out.text).not.toContain('first deploy');
  });

  it('devHistory: SUSPECT renders suspect warning with migration rate', () => {
    const devSuspect: DevHistoryVerdict = {
      tier: 'SUSPECT',
      previousTokens: 4,
      matureTokens: 4,
      knownMigrations: 4,
      migrations: 1,
      migrationRate: 0.25,
      ruggedCount: 0,
      reasons: ['low migration rate'],
    };
    const out = formatTieredSignal(formatInput({ devHistory: devSuspect }));
    expect(out.text).toContain('• Dev History: ⚠️ SUSPECT (1/4 migrated, rate 25%)');
  });

  it('devHistory: null/undefined does not render dev history line (backward-compatible)', () => {
    const outNull = formatTieredSignal(formatInput({ devHistory: null }));
    expect(outNull.text).not.toContain('Dev History:');

    const outUndef = formatTieredSignal(formatInput({ devHistory: undefined }));
    expect(outUndef.text).not.toContain('Dev History:');

    const outDefault = formatTieredSignal(formatInput());
    expect(outDefault.text).not.toContain('Dev History:');
  });

  it('bondingCurve renders bonding curve progress percentage and state', () => {
    const out = formatTieredSignal(
      formatInput({ bondingCurve: { progressPct: 88.5, state: 'Graduating' } }),
    );
    expect(out.text).toContain('• Bonding Curve: 🚀 88.5% (Graduating)');
  });

  it('bondingCurve uses Graduating fallback when state is omitted', () => {
    const out = formatTieredSignal(
      formatInput({ bondingCurve: { progressPct: 92.4 } }),
    );
    expect(out.text).toContain('• Bonding Curve: 🚀 92.4% (Graduating)');
  });

  it('formatPotentialCoinSignal also renders devHistory and bondingCurve correctly', () => {
    const out = formatPotentialCoinSignal({
      payload: payload(),
      tier: 'CANDIDATE',
      tierReasons: ['passed prefilter'],
      tierMissing: ['wallet confirmation'],
      smartMoney: null,
      marketCapUsd: 100_000,
      liquidityUsd: 25_000,
      devHistory: {
        tier: 'CLEAN',
        previousTokens: 3,
        matureTokens: 3,
        knownMigrations: 3,
        migrations: 2,
        migrationRate: 0.67,
        ruggedCount: 0,
        reasons: ['clean history'],
      },
      bondingCurve: { progressPct: 89.1, state: 'Sweet-Spot' },
    });
    expect(out.text).toContain('• Dev History: ✅ CLEAN (2/3 migrated)');
    expect(out.text).toContain('• Bonding Curve: 🚀 89.1% (Sweet-Spot)');
  });
});
