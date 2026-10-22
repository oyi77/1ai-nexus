// ─────────────────────────────────────────────────────────────
// Sniper criteria engine tests — every ebook threshold gets a test.
// Values asserted here are quoted from the operator's 7 ebooks;
// changing an expectation means changing an operator-agreed rule.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  evaluateProfile,
  numOrNull,
  boolOrNull,
  GOLDEN_NEW_PAIRS,
  GOLDEN_POST_MIGRATED,
  SNIPER_LAUNCH,
  BONDING_POST,
  EXPOSURE_EARLY,
  ALL_PROFILES,
  EBOOK_DOCS,
  type SniperMetrics,
} from './sniper-criteria';

const clean: SniperMetrics = {
  devHoldingPct: 0,
  sniperPct: 0,
  insiderPct: 0,
  bundlerPct: 0,
  freshWalletPct: 0,
  top10HoldersPct: 15,
  earlyBuyerPct: 10,
  devSnipedPct: 0,
  clusterPct: 0,
  singleWhalePct: 0,
  volumeToMc: 5,
  proTraderCount: 60,
  tokenAgeMin: 30,
  marketCapUsd: 50_000,
  survivedPostBondingMin: 30,
  rugProbabilityPct: 0,
  lpBurntPct: 100,
  mintEnabled: false,
  freezeEnabled: false,
  smartWalletPnlPct: 20,
  sniperTop1or2Fresh: false,
  sniperTop3IsSniper: false,
  bubblemapChained: false,
};

describe('boundary normalization', () => {
  it('numOrNull rejects non-finite and empty, accepts numeric strings', () => {
    expect(numOrNull(5)).toBe(5);
    expect(numOrNull('5.5')).toBe(5.5);
    expect(numOrNull('')).toBeNull();
    expect(numOrNull('abc')).toBeNull();
    expect(numOrNull(NaN)).toBeNull();
    expect(numOrNull(Infinity)).toBeNull();
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull({})).toBeNull();
  });

  it('boolOrNull whitelists only real booleans', () => {
    expect(boolOrNull(true)).toBe(true);
    expect(boolOrNull('true')).toBe(true);
    expect(boolOrNull(false)).toBe(false);
    expect(boolOrNull('false')).toBe(false);
    expect(boolOrNull('yes')).toBeNull();
    expect(boolOrNull(1)).toBeNull();
    expect(boolOrNull(undefined)).toBeNull();
  });
});

describe('Golden Second — New Pairs (doc matrix)', () => {
  it('clean metrics pass all gates', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, clean);
    expect(r.verdict).toBe('pass');
    expect(r.rejects).toEqual([]);
    expect(r.unknowns).toEqual([]);
  });

  it('dev holding >2% is a hard reject', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, devHoldingPct: 2.1 });
    expect(r.verdict).toBe('reject');
    expect(r.rejects.some((x) => x.includes('Dev Holding'))).toBe(true);
  });

  it('dev holding exactly 2% still passes (threshold is >2%)', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, devHoldingPct: 2 });
    expect(r.rejects).toEqual([]);
  });

  it('red snipers >=6% is a hard reject', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, sniperPct: 6 });
    expect(r.verdict).toBe('reject');
    expect(r.rejects.some((x) => x.includes('Red Snipers'))).toBe(true);
  });

  it('bundlers >40% rejects, exactly 40% passes (rule is ≤40%)', () => {
    expect(evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, bundlerPct: 40 }).rejects).toEqual([]);
    expect(evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, bundlerPct: 40.1 }).verdict).toBe('reject');
  });

  it('insider >=6% is a hard reject', () => {
    expect(evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, insiderPct: 6 }).verdict).toBe('reject');
  });

  it('cluster or single whale >5% rejects', () => {
    expect(evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, clusterPct: 5.1 }).verdict).toBe('reject');
    expect(evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, singleWhalePct: 5.1 }).verdict).toBe('reject');
    expect(evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, clusterPct: 5 }).rejects).toEqual([]);
  });

  it('volume <2x MC is a warn, not a reject', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, volumeToMc: 1.9 });
    expect(r.verdict).toBe('watch');
    expect(r.rejects).toEqual([]);
    expect(r.warns.some((x) => x.includes('Volume vs MC'))).toBe(true);
  });

  it('prints a measured share as a reading, not a raw float dump', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, { ...clean, singleWhalePct: 49.10175247 });
    expect(r.rejects).toEqual(['Single Whale (49.1 vs single-whale ≤ 5%)']);
  });

  it('spells a boolean gate breach instead of leaking its field name', () => {
    const r = evaluateProfile(BONDING_POST, { ...clean, mintEnabled: true, freezeEnabled: false });
    expect(r.rejects).toContain('Mint disabled (true vs mint-off must be false)');
  });
});

describe('Golden Second — Post-Migrated', () => {
  it('volume <4x is a warn', () => {
    const r = evaluateProfile(GOLDEN_POST_MIGRATED, { ...clean, volumeToMc: 3.9 });
    expect(r.verdict).toBe('watch');
    expect(r.warns.some((x) => x.includes('4'))).toBe(true);
  });

  it('smart wallet PnL >200% rejects (dump risk)', () => {
    const r = evaluateProfile(GOLDEN_POST_MIGRATED, { ...clean, smartWalletPnlPct: 201 });
    expect(r.verdict).toBe('reject');
  });

  it('smart wallet PnL 150% passes the dump gate', () => {
    expect(evaluateProfile(GOLDEN_POST_MIGRATED, { ...clean, smartWalletPnlPct: 150 }).rejects).toEqual([]);
  });
});

describe('Sniper launch (Teknik Sniper Memecoin)', () => {
  it('clean snipe passes', () => {
    expect(evaluateProfile(SNIPER_LAUNCH, clean).verdict).toBe('pass');
  });

  it('dev holding >3% rejects', () => {
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, devHoldingPct: 3.1 }).verdict).toBe('reject');
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, devHoldingPct: 3 }).rejects).toEqual([]);
  });

  it('top10 >30%, insider >5%, bundlers >10%, snipers >7%, fresh >10% all reject', () => {
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, top10HoldersPct: 30.1 }).verdict).toBe('reject');
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, insiderPct: 5.1 }).verdict).toBe('reject');
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, bundlerPct: 10.1 }).verdict).toBe('reject');
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, sniperPct: 7.1 }).verdict).toBe('reject');
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, freshWalletPct: 10.1 }).verdict).toBe('reject');
  });

  it('rug probability 100% rejects', () => {
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, rugProbabilityPct: 100 }).verdict).toBe('reject');
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, rugProbabilityPct: 99 }).rejects).toEqual([]);
  });

  it('Top1-2 fresh wallet rejects', () => {
    const r = evaluateProfile(SNIPER_LAUNCH, { ...clean, sniperTop1or2Fresh: true });
    expect(r.verdict).toBe('reject');
  });

  it('Top1-3 sniper wallet rejects', () => {
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, sniperTop3IsSniper: true }).verdict).toBe('reject');
  });

  it('chain-linked bubblemap rejects', () => {
    expect(evaluateProfile(SNIPER_LAUNCH, { ...clean, bubblemapChained: true }).verdict).toBe('reject');
  });
});

describe('Bonding post-migration', () => {
  it('clean post-bonding passes', () => {
    expect(evaluateProfile(BONDING_POST, clean).verdict).toBe('pass');
  });

  it('did not survive 10 min rejects', () => {
    expect(evaluateProfile(BONDING_POST, { ...clean, survivedPostBondingMin: 9 }).verdict).toBe('reject');
    expect(evaluateProfile(BONDING_POST, { ...clean, survivedPostBondingMin: 10 }).rejects).toEqual([]);
  });

  it('dev sniped >12% rejects', () => {
    expect(evaluateProfile(BONDING_POST, { ...clean, devSnipedPct: 12.1 }).verdict).toBe('reject');
  });

  it('early buyers >20% rejects; top10 >30% rejects', () => {
    expect(evaluateProfile(BONDING_POST, { ...clean, earlyBuyerPct: 20.1 }).verdict).toBe('reject');
    expect(evaluateProfile(BONDING_POST, { ...clean, top10HoldersPct: 30.1 }).verdict).toBe('reject');
  });

  it('insider >2% and fresh >3% reject (strictest of all docs)', () => {
    expect(evaluateProfile(BONDING_POST, { ...clean, insiderPct: 2.1 }).verdict).toBe('reject');
    expect(evaluateProfile(BONDING_POST, { ...clean, freshWalletPct: 3.1 }).verdict).toBe('reject');
  });

  it('unsold snipers >12% reject', () => {
    expect(evaluateProfile(BONDING_POST, { ...clean, sniperPct: 12.1 }).verdict).toBe('reject');
  });

  it('LP burnt below 100% is a warn not a reject', () => {
    const r = evaluateProfile(BONDING_POST, { ...clean, lpBurntPct: 90 });
    expect(r.verdict).toBe('watch');
    expect(r.rejects).toEqual([]);
  });

  it('mint or freeze enabled rejects', () => {
    expect(evaluateProfile(BONDING_POST, { ...clean, mintEnabled: true }).verdict).toBe('reject');
    expect(evaluateProfile(BONDING_POST, { ...clean, freezeEnabled: true }).verdict).toBe('reject');
  });
});

describe('Exposure early (The Eksposure Game)', () => {
  it('clean early-window metrics pass', () => {
    expect(evaluateProfile(EXPOSURE_EARLY, clean).verdict).toBe('pass');
  });

  it('dev >2% rejects', () => {
    expect(evaluateProfile(EXPOSURE_EARLY, { ...clean, devHoldingPct: 2.1 }).verdict).toBe('reject');
  });

  it('snipers >15% rejects (loosest band of the docs)', () => {
    expect(evaluateProfile(EXPOSURE_EARLY, { ...clean, sniperPct: 15.1 }).verdict).toBe('reject');
    expect(evaluateProfile(EXPOSURE_EARLY, { ...clean, sniperPct: 15 }).rejects).toEqual([]);
  });

  it('insider >8% rejects', () => {
    expect(evaluateProfile(EXPOSURE_EARLY, { ...clean, insiderPct: 8.1 }).verdict).toBe('reject');
  });

  it('token age >120 min warns', () => {
    const r = evaluateProfile(EXPOSURE_EARLY, { ...clean, tokenAgeMin: 130 });
    expect(r.warns.some((x) => x.includes('age'))).toBe(true);
  });

  it('MC below $12k warns', () => {
    const r = evaluateProfile(EXPOSURE_EARLY, { ...clean, marketCapUsd: 11_000 });
    expect(r.warns.some((x) => x.includes('Market Cap'))).toBe(true);
  });

  it('pro trader count below 20 warns', () => {
    const r = evaluateProfile(EXPOSURE_EARLY, { ...clean, proTraderCount: 19 });
    expect(r.warns.some((x) => x.includes('Pro Trader'))).toBe(true);
  });
});

describe('unknown discipline — absent data never passes', () => {
  it('empty metrics produce all-unknown and verdict watch, never pass', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, {});
    expect(r.verdict).toBe('watch');
    expect(r.unknowns.length).toBeGreaterThan(0);
    expect(r.rejects).toEqual([]);
    for (const g of r.gates) expect(g.value).toBeNull();
  });

  it('malformed strings become unknown, not 0', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, {
      ...clean,
      devHoldingPct: 'none' as unknown as number,
      sniperPct: NaN,
    });
    const dev = r.gates.find((g) => g.key === 'dev-holding');
    const sn = r.gates.find((g) => g.key === 'red-snipers');
    expect(dev?.verdict).toBe('unknown');
    expect(sn?.verdict).toBe('unknown');
    expect(r.verdict).toBe('watch');
  });

  it('partial metrics: present gates evaluated, absent gates unknown', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, { devHoldingPct: 0, sniperPct: 0 });
    expect(r.gates.find((g) => g.key === 'dev-holding')?.verdict).toBe('pass');
    expect(r.gates.find((g) => g.key === 'bundlers')?.verdict).toBe('unknown');
    expect(r.verdict).toBe('watch');
  });

  it('one reject beats many unknowns', () => {
    const r = evaluateProfile(GOLDEN_NEW_PAIRS, { devHoldingPct: 99 });
    expect(r.verdict).toBe('reject');
  });
});

describe('provenance', () => {
  it('every profile cites its source doc id', () => {
    for (const p of ALL_PROFILES) expect(p.doc).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(EBOOK_DOCS.length).toBe(ALL_PROFILES.length);
  });

  it('profiles do not silently share one threshold set', () => {
    const devT = new Set(ALL_PROFILES.map((p) => p.numRules.find((r) => r.key === 'dev-holding')?.threshold));
    expect(devT.size).toBeGreaterThan(1);
  });
});
