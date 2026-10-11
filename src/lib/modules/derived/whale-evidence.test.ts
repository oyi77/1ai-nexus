// ─────────────────────────────────────────────────────────────
// Whale evidence builder tests — boundary + fail-closed coverage.
// Pure, zero I/O. Thresholds come from SMART_MONEY_DEFAULTS.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  buildWhaleEvidence,
  buildWhaleEvidenceSimple,
  type PositionSnapshot,
  type PortfolioSnapshot,
  type BuyVolume30dInput,
} from './whale-evidence';
import { SMART_MONEY_DEFAULTS, classifyWallet, type ClassifyInput, type TradeEpisode } from './wallet-intel';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function pos(valueUsd: number | null, over: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    mint: 'MintX',
    valueUsd,
    measuredAt: NOW - 1000,
    source: 'solana-rpc',
    completeness: valueUsd === null ? 'partial' : 'complete',
    limitations: [],
    ...over,
  };
}

function port(totalUsd: number | null, over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    totalUsd,
    measuredAt: NOW - 1000,
    source: 'solana-rpc',
    completeness: totalUsd === null ? 'partial' : 'complete',
    limitations: [],
    ...over,
  };
}

function buys(legs: BuyVolume30dInput['legs']): BuyVolume30dInput {
  return { legs, windowMs: 30 * DAY, now: NOW };
}

function ep(token: string, buy: number, sell: number): TradeEpisode {
  return { token, buyCost: buy, sellProceeds: sell, feeKnown: true, openFrac: 0 };
}

function baseInput(episodes: TradeEpisode[], whale: ClassifyInput['whale']): ClassifyInput {
  return {
    episodes,
    whale,
    tx7d: 12,
    distinctTokensTraded: 10,
    feeComplete: true,
    clusterDataAvailable: true,
  };
}

const whaleCfg = SMART_MONEY_DEFAULTS;

describe('whale evidence — boundaries', () => {
  it('below threshold does not pass', () => {
    const r = buildWhaleEvidence(
      [pos(whaleCfg.whaleSinglePositionUsd - 1)],
      port(whaleCfg.whalePortfolioUsd - 1),
      buys([{ ts: NOW - DAY, usd: whaleCfg.whaleBuyVolume30dUsd - 1, completeness: 'complete', hasHistoricalUsd: true }]),
      null,
      whaleCfg,
      NOW,
    );
    expect(r.evidence.maxSinglePositionUsd).toBe(whaleCfg.whaleSinglePositionUsd - 1);
    expect(r.gates.maxSinglePositionUsd).toBe(false);
    expect(r.gates.portfolioUsd).toBe(false);
    expect(r.gates.buyVolume30dUsd).toBe(false);
  });

  it('exactly at threshold passes', () => {
    const r = buildWhaleEvidence(
      [pos(whaleCfg.whaleSinglePositionUsd)],
      port(whaleCfg.whalePortfolioUsd),
      buys([{ ts: NOW - DAY, usd: whaleCfg.whaleBuyVolume30dUsd, completeness: 'complete', hasHistoricalUsd: true }]),
      null,
      whaleCfg,
      NOW,
    );
    expect(r.gates.maxSinglePositionUsd).toBe(true);
    expect(r.gates.portfolioUsd).toBe(true);
    expect(r.gates.buyVolume30dUsd).toBe(true);
  });

  it('above threshold passes', () => {
    const r = buildWhaleEvidence(
      [pos(whaleCfg.whaleSinglePositionUsd + 1)],
      port(whaleCfg.whalePortfolioUsd + 1),
      buys([{ ts: NOW - DAY, usd: whaleCfg.whaleBuyVolume30dUsd + 1, completeness: 'complete', hasHistoricalUsd: true }]),
      null,
      whaleCfg,
      NOW,
    );
    expect(r.gates.maxSinglePositionUsd).toBe(true);
    expect(r.gates.portfolioUsd).toBe(true);
    expect(r.gates.buyVolume30dUsd).toBe(true);
  });
});

describe('whale evidence — fail closed', () => {
  it('missing inputs stay null and never pass', () => {
    const r = buildWhaleEvidence([], port(null), buys([]), null, whaleCfg, NOW);
    expect(r.evidence.maxSinglePositionUsd).toBeNull();
    expect(r.evidence.portfolioUsd).toBeNull();
    expect(r.evidence.buyVolume30dUsd).toBeNull();
    expect(r.evidence.contextMcapUsd).toBeNull();
    expect(r.gates.maxSinglePositionUsd).toBe(false);
    expect(r.gates.portfolioUsd).toBe(false);
    expect(r.gates.buyVolume30dUsd).toBe(false);
    expect(r.metadata.completeness).toBe('missing');
  });

  it('partial position does not count', () => {
    const r = buildWhaleEvidence([pos(null), pos(whaleCfg.whaleSinglePositionUsd + 1000, { completeness: 'partial' })], port(null), buys([]), null, whaleCfg, NOW);
    expect(r.evidence.maxSinglePositionUsd).toBeNull();
  });

  it('current-only portfolio is flagged and does not pass', () => {
    const r = buildWhaleEvidence([], port(whaleCfg.whalePortfolioUsd, { completeness: 'current-only' }), buys([]), null, whaleCfg, NOW);
    expect(r.evidence.portfolioUsd).toBe(whaleCfg.whalePortfolioUsd);
    expect(r.metadata.freshness).toBe('stale');
    expect(r.metadata.limitations.some((l) => l.includes('current-only'))).toBe(true);
  });

  it('stale measurement is flagged', () => {
    const r = buildWhaleEvidence([], port(1000, { measuredAt: NOW - 100 * DAY }), buys([]), null, whaleCfg, NOW);
    expect(r.metadata.freshness).toBe('stale');
  });

  it('buy leg without historical USD is excluded', () => {
    const r = buildWhaleEvidence(
      [],
      port(null),
      buys([
        { ts: NOW - DAY, usd: whaleCfg.whaleBuyVolume30dUsd + 1, completeness: 'complete', hasHistoricalUsd: false },
      ]),
      null,
      whaleCfg,
      NOW,
    );
    expect(r.evidence.buyVolume30dUsd).toBeNull();
    expect(r.gates.buyVolume30dUsd).toBe(false);
  });

  it('partial buy legs are excluded from the sum', () => {
    const r = buildWhaleEvidence(
      [],
      port(null),
      buys([
        { ts: NOW - DAY, usd: 10_000, completeness: 'partial', hasHistoricalUsd: true },
        { ts: NOW - DAY, usd: 5_000, completeness: 'complete', hasHistoricalUsd: true },
      ]),
      null,
      whaleCfg,
      NOW,
    );
    expect(r.evidence.buyVolume30dUsd).toBe(5_000);
  });

  it('legs outside the 30d window are excluded', () => {
    const r = buildWhaleEvidence(
      [],
      port(null),
      buys([{ ts: NOW - 31 * DAY, usd: 999_999, completeness: 'complete', hasHistoricalUsd: true }]),
      null,
      whaleCfg,
      NOW,
    );
    expect(r.evidence.buyVolume30dUsd).toBeNull();
  });
});

describe('whale evidence — classifier integration', () => {
  it('complete evidence can reach whale via existing classifier', () => {
    const built = buildWhaleEvidence(
      [pos(whaleCfg.whaleSinglePositionUsd + 1000)],
      port(whaleCfg.whalePortfolioUsd + 1000),
      buys([{ ts: NOW - DAY, usd: whaleCfg.whaleBuyVolume30dUsd + 1000, completeness: 'complete', hasHistoricalUsd: true }]),
      null,
      whaleCfg,
      NOW,
    );
    // thin sample -> PROVISIONAL, but whale leg must still be recognised
    const episodes: TradeEpisode[] = Array.from({ length: 12 }, (_, i) => ep(`T${i}`, 100, 200));
    const d = classifyWallet(baseInput(episodes, built.evidence));
    expect(['WHALE', 'WHALE_AND_SMART_MONEY', 'PROVISIONAL']).toContain(d.status);
    expect(built.gates.maxSinglePositionUsd).toBe(true);
  });

  it('incomplete evidence never triggers whale', () => {
    const built = buildWhaleEvidence([], port(null), buys([]), null, whaleCfg, NOW);
    const episodes: TradeEpisode[] = Array.from({ length: 20 }, (_, i) => ep(`T${i % 8}`, 100, 200));
    const d = classifyWallet(baseInput(episodes, built.evidence));
    expect(d.status).not.toBe('WHALE');
    expect(d.status).not.toBe('WHALE_AND_SMART_MONEY');
  });

  it('simple wrapper mirrors the evidence shape', () => {
    const e = buildWhaleEvidenceSimple(1, 2, 3, 4);
    expect(e).toEqual({ maxSinglePositionUsd: 1, portfolioUsd: 2, buyVolume30dUsd: 3, contextMcapUsd: 4 });
  });
});
