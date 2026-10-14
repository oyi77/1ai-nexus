// ─────────────────────────────────────────────────────────────
// wallet-intel classifier tests — boundary + definition coverage.
// Pure function, zero I/O, zero DB. Every agreed definition gets a test:
// PnL realized/fee/open-exclusion/outlier-drop/samples; WR denominator;
// whale three legs + New-Pairs phase rule; status ladder incl.
// PROVISIONAL (never qualified) and UNKNOWN.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  classifyWallet,
  SMART_MONEY_DEFAULTS,
  type ClassifyInput,
  type TradeEpisode,
} from './wallet-intel';

function ep(token: string, buy: number, sell: number, over: Partial<TradeEpisode> = {}): TradeEpisode {
  return { token, buyCost: buy, sellProceeds: sell, feeKnown: true, openFrac: 0, ...over };
}

function input(episodes: TradeEpisode[], over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    episodes,
    whale: { maxSinglePositionUsd: null, portfolioUsd: null, buyVolume30dUsd: null },
    tx7d: 12,
    tx7dTruncated: false,
    distinctTokensTraded: 10,
    feeComplete: true,
    clusterDataAvailable: true,
    ...over,
  };
}

/** 20 closed episodes, PnL ≈ +85%, WR 75%, 8 distinct tokens, 6 profitable. */
function strong(n = 20): TradeEpisode[] {
  const out: TradeEpisode[] = [];
  for (let i = 0; i < n; i++) {
    const t = `T${i % 8}`;
    // losers on i%4==0: buy 100, sell 90 (-10%)
    // winners: buy 100, sell 200 (+100%)
    out.push(i % 4 === 0 ? ep(t, 100, 90) : ep(t, 100, 200));
  }
  return out;
}

describe('qualify path', () => {
  it('qualifies a wallet that clears PnL, WR, samples, tokens', () => {
    const d = classifyWallet(input(strong()));
    expect(d.status).toBe('QUALIFIED_SMART_MONEY');
    expect(d.smartPass).toBe(true);
    expect(d.pnl30d).toBeGreaterThanOrEqual(SMART_MONEY_DEFAULTS.pnl30dMin);
    expect(d.winRate).toBeGreaterThanOrEqual(SMART_MONEY_DEFAULTS.winRateMin);
    expect(d.confidence).toBe('high');
  });

  it('returns WHALE_AND_SMART_MONEY when both legs pass', () => {
    const d = classifyWallet(
      input(strong(), { whale: { maxSinglePositionUsd: 80_000, portfolioUsd: null, buyVolume30dUsd: null } }),
    );
    expect(d.status).toBe('WHALE_AND_SMART_MONEY');
  });
});

describe('sample gates — never qualify under-sampled wallets', () => {
  it('n=14 → PROVISIONAL even with giant PnL', () => {
    const d = classifyWallet(input(strong(14)));
    expect(d.status).toBe('PROVISIONAL');
    expect(d.smartPass).toBe(false);
  });

  it('n=9 → not even PROVISIONAL', () => {
    const d = classifyWallet(input(strong(9)));
    expect(['UNKNOWN', 'DISQUALIFIED']).toContain(d.status);
    expect(d.smartPass).toBe(false);
  });

  it('400% from 3 trades → UNKNOWN (below the provisional band), never qualified', () => {
    const d = classifyWallet(
      input([ep('A', 100, 500), ep('B', 100, 500), ep('C', 100, 500)], { distinctTokensTraded: 3 }),
    );
    expect(d.status).toBe('UNKNOWN');
    expect(d.smartPass).toBe(false);
  });

  it('10–14 episodes → PROVISIONAL even with strong numbers', () => {
    const d = classifyWallet(input(strong(12)));
    expect(d.status).toBe('PROVISIONAL');
    expect(d.smartPass).toBe(false);
  });

  it('fails when profitable tokens < 5 even if PnL/WR pass', () => {
    // All wins on ONE token: PnL +110%, WR 100%, n=20 (no outlier drop),
    // but only 1 profitable token → the breadth guard blocks.
    const eps = [
      ep('A', 100, 300), ep('A', 100, 300),
      ...Array.from({ length: 18 }, () => ep('A', 100, 200)),
    ];
    const d = classifyWallet(input(eps));
    expect(d.pnl30d).toBeGreaterThan(0.7);
    expect(d.winRate).toBe(1);
    expect(d.profitableTokens).toBe(1);
    expect(d.smartPass).toBe(false);
    expect(['PROVISIONAL', 'DISQUALIFIED', 'UNKNOWN']).toContain(d.status);
  });
});

describe('outlier guard', () => {
  it('drops the largest episode when n<20', () => {
    // 10 small losers + 1 giant winner: without the guard the giant dominates.
    const eps = [
      ...Array.from({ length: 10 }, (_, i) => ep(`L${i}`, 100, 95)),
      ep('GIANT', 100_000, 300_000),
    ];
    const d = classifyWallet(input(eps, { distinctTokensTraded: 11 }));
    expect(d.reasons.join(' ')).toContain('largest episode dropped');
    expect(d.smartPass).toBe(false);
  });

  it('keeps all episodes when n>=20 (no drop)', () => {
    const d = classifyWallet(input(strong(20)));
    expect(d.reasons.join(' ')).not.toContain('largest episode dropped');
    expect(d.episodes).toBe(20);
  });
});

describe('open positions and fees', () => {
  it('excludes >10% unsold from numerator AND denominator', () => {
    const eps = [...strong(15), ep('OPEN', 100, 500, { openFrac: 0.8 })];
    const d = classifyWallet(input(eps));
    expect(d.openExcluded).toBe(1);
    expect(d.episodes).toBe(15); // closed count (pre-drop)
    expect(d.episodesUsed).toBe(14); // scored after the single-giant guard
  });

  it('UNKNOWN when every episode is still open', () => {
    const d = classifyWallet(input([ep('A', 100, 200, { openFrac: 0.9 })]));
    expect(d.status).toBe('UNKNOWN');
    expect(d.pnl30d).toBeNull();
  });

  it('missing fees downgrade confidence, not silently zero', () => {
    const d = classifyWallet(input(strong(), { feeComplete: false }));
    expect(d.limitations.join(' ')).toContain('fees incomplete');
    expect(d.confidence).toBe('medium');
  });
});

describe('whale legs', () => {
  const sm = () =>
    input(
      [ep('A', 100, 50)],
      { distinctTokensTraded: 1 },
    );
  it('single position ≥ $50k → WHALE', () => {
    const d = classifyWallet({ ...sm(), whale: { maxSinglePositionUsd: 60_000, portfolioUsd: null, buyVolume30dUsd: null } });
    expect(d.status).toBe('WHALE');
  });
  it('portfolio ≥ $250k → WHALE', () => {
    const d = classifyWallet({ ...sm(), whale: { maxSinglePositionUsd: null, portfolioUsd: 300_000, buyVolume30dUsd: null } });
    expect(d.status).toBe('WHALE');
  });
  it('30d buy volume ≥ $250k → WHALE', () => {
    const d = classifyWallet({ ...sm(), whale: { maxSinglePositionUsd: null, portfolioUsd: null, buyVolume30dUsd: 400_000 } });
    expect(d.status).toBe('WHALE');
  });
  it('New-Pairs phase rule: $25k position qualifies under $500k mcap', () => {
    const d = classifyWallet({
      ...sm(),
      whale: { maxSinglePositionUsd: 30_000, portfolioUsd: null, buyVolume30dUsd: null, contextMcapUsd: 300_000 },
    });
    expect(d.status).toBe('WHALE');
    const d2 = classifyWallet({
      ...sm(),
      whale: { maxSinglePositionUsd: 30_000, portfolioUsd: null, buyVolume30dUsd: null, contextMcapUsd: 2_000_000 },
    });
    expect(d2.whalePass).toBe(false);
  });
  it('label-only whale claim stays UNVERIFIED (no numbers → no pass)', () => {
    const d = classifyWallet(sm());
    expect(d.whalePass).toBe(false);
  });
});

describe('win-rate semantics', () => {
  it('counts per closed episode, win = realized > 0 after fees', () => {
    // 9 wins of +10, 6 losses of -50 → WR 60% exactly, PnL negative → DISQUALIFIED on PnL
    const eps = [
      ...Array.from({ length: 12 }, (_, i) => ep(`W${i}`, 100, 110)),
      ...Array.from({ length: 8 }, (_, i) => ep(`L${i}`, 100, 50)),
    ];
    const d = classifyWallet(input(eps, { distinctTokensTraded: 15 }));
    expect(d.winRate).toBeCloseTo(0.6, 5);
    expect(d.status).toBe('DISQUALIFIED');
  });

  it('flat (0%) episode counts as a loss', () => {
    const eps = [...Array.from({ length: 14 }, (_, i) => ep(`W${i}`, 100, 200)), ep('F', 100, 100)];
    const d = classifyWallet(input(eps, { distinctTokensTraded: 15 }));
    expect(d.winRate).toBeCloseTo(13 / 14, 3);
    expect(d.episodesUsed).toBe(14);
  });
});

describe('empty input', () => {
  it('no episodes → UNKNOWN with no claims', () => {
    const d = classifyWallet(input([]));
    expect(d.status).toBe('UNKNOWN');
    expect(d.pnl30d).toBeNull();
    expect(d.winRate).toBeNull();
  });
});

describe('custom thresholds stay configurable', () => {
  it('honours an overridden whale cutoff', () => {
    const d = classifyWallet(
      input([ep('A', 100, 50)], {
        distinctTokensTraded: 1,
        whale: { maxSinglePositionUsd: 10_000, portfolioUsd: null, buyVolume30dUsd: null },
      }),
      { whaleSinglePositionUsd: 5_000 },
    );
    expect(d.status).toBe('WHALE');
  });
});
