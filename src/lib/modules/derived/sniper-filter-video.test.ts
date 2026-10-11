// ─────────────────────────────────────────────────────────────
// Sniper filter (VIDEO source) — operator's transcribed tool settings.
// Every threshold is quoted from the transcript with a line cite.
// Boundary + UNKNOWN discipline, and the video-vs-PDF conflicts are
// asserted so a silent edit cannot collapse them.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  VIDEO_NEW_PAIRS,
  VIDEO_FINAL_STRETCH,
  VIDEO_VS_PDF_CONFLICTS,
  VIDEO_MANUAL_CHECKS,
  evaluateVideoFilter,
  numOrNull,
  type VideoFilterMetrics,
} from './sniper-filter-video';

/** Metrics that clear every NEW PAIRS gate. */
const clean: VideoFilterMetrics = {
  tokenAgeMin: 60,
  devHoldingPct: 0,
  sniperPct: 0,
  insiderPct: 0,
  bundlerPct: 0,
  proTraderCount: 20,
  marketCapUsd: 7_000,
};

describe('numOrNull — trust boundary', () => {
  it('rejects NaN, Infinity, empty string, junk; keeps real numbers', () => {
    expect(numOrNull(NaN)).toBeNull();
    expect(numOrNull(Infinity)).toBeNull();
    expect(numOrNull('')).toBeNull();
    expect(numOrNull('none')).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull('12.5')).toBe(12.5);
    expect(numOrNull(0)).toBe(0);
  });
});

describe('VIDEO NEW PAIRS — operator tool settings', () => {
  it('clean metrics pass', () => {
    const r = evaluateVideoFilter(VIDEO_NEW_PAIRS, clean);
    expect(r.verdict).toBe('pass');
    expect(r.rejects).toEqual([]);
  });

  it('dev holding above 0% rejects (video says 0-0%)', () => {
    const r = evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, devHoldingPct: 0.1 });
    expect(r.verdict).toBe('reject');
    expect(r.rejects.some((x) => x.includes('Dev Holding'))).toBe(true);
  });

  it('sniper exactly 12% passes, 12.1% rejects', () => {
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, sniperPct: 12 }).rejects).toEqual([]);
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, sniperPct: 12.1 }).verdict).toBe('reject');
  });

  it('insider exactly 8% passes, 8.1% rejects', () => {
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, insiderPct: 8 }).rejects).toEqual([]);
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, insiderPct: 8.1 }).verdict).toBe('reject');
  });

  it('bundlers exactly 30% passes, 30.1% rejects', () => {
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, bundlerPct: 30 }).rejects).toEqual([]);
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, bundlerPct: 30.1 }).verdict).toBe('reject');
  });

  it('age exactly 300 min passes, 301 rejects', () => {
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, tokenAgeMin: 300 }).rejects).toEqual([]);
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, tokenAgeMin: 301 }).verdict).toBe('reject');
  });

  it('pro trader 19 rejects, 20 passes', () => {
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, proTraderCount: 19 }).verdict).toBe('reject');
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, proTraderCount: 20 }).rejects).toEqual([]);
  });

  it('MC 6999 rejects, 7000 passes', () => {
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, marketCapUsd: 6_999 }).verdict).toBe('reject');
    expect(evaluateVideoFilter(VIDEO_NEW_PAIRS, { ...clean, marketCapUsd: 7_000 }).rejects).toEqual([]);
  });
});

describe('VIDEO FINAL STRETCH — differs only in age min and MC', () => {
  it('age 10 min rejects (min is 11), 11 passes', () => {
    const fs = { ...clean, marketCapUsd: 12_000 };
    expect(evaluateVideoFilter(VIDEO_FINAL_STRETCH, { ...fs, tokenAgeMin: 10 }).verdict).toBe('reject');
    expect(evaluateVideoFilter(VIDEO_FINAL_STRETCH, { ...fs, tokenAgeMin: 11 }).rejects).toEqual([]);
  });

  it('MC 11999 rejects, 12000 passes', () => {
    expect(evaluateVideoFilter(VIDEO_FINAL_STRETCH, { ...clean, marketCapUsd: 11_999 }).verdict).toBe('reject');
    expect(evaluateVideoFilter(VIDEO_FINAL_STRETCH, { ...clean, marketCapUsd: 12_000, tokenAgeMin: 11 }).rejects).toEqual([]);
  });

  it('New Pairs and Final Stretch share sniper/insider/bundler limits', () => {
    const np = VIDEO_NEW_PAIRS.rules.filter((r) => ['snipers', 'insider', 'bundlers'].includes(r.key));
    const fs = VIDEO_FINAL_STRETCH.rules.filter((r) => ['snipers', 'insider', 'bundlers'].includes(r.key));
    expect(np.map((r) => r.max)).toEqual(fs.map((r) => r.max));
  });
});

describe('UNKNOWN discipline — absent data never passes', () => {
  it('all-missing metrics → watch, zero passes', () => {
    const r = evaluateVideoFilter(VIDEO_NEW_PAIRS, {});
    expect(r.verdict).toBe('watch');
    expect(r.gates.every((g) => g.verdict === 'unknown')).toBe(true);
    expect(r.unknowns.length).toBe(VIDEO_NEW_PAIRS.rules.length);
  });

  it('string "none" and NaN are unknown, not pass and not 0', () => {
    const r = evaluateVideoFilter(VIDEO_NEW_PAIRS, {
      ...clean,
      devHoldingPct: 'none' as unknown as number,
      sniperPct: NaN,
    });
    expect(r.gates.find((g) => g.key === 'dev-holding')?.verdict).toBe('unknown');
    expect(r.gates.find((g) => g.key === 'snipers')?.verdict).toBe('unknown');
  });

  it('one reject beats many unknowns', () => {
    const r = evaluateVideoFilter(VIDEO_NEW_PAIRS, { devHoldingPct: 99 });
    expect(r.verdict).toBe('reject');
  });

  it('top holders is deliberately not a gate (unsatisfiable in the video)', () => {
    const keys = [...VIDEO_NEW_PAIRS.rules, ...VIDEO_FINAL_STRETCH.rules].map((r) => r.key);
    expect(keys).not.toContain('top-holders');
  });
});

describe('provenance', () => {
  it('every rule carries the operator quote it came from', () => {
    for (const r of [...VIDEO_NEW_PAIRS.rules, ...VIDEO_FINAL_STRETCH.rules]) {
      expect(r.quote.length).toBeGreaterThan(5);
    }
  });

  it('video vs PDF conflicts stay documented, not collapsed', () => {
    const keys = VIDEO_VS_PDF_CONFLICTS.map((c) => c.key);
    expect(keys).toContain('dev-holding');
    expect(keys).toContain('snipers');
    expect(keys).toContain('bundlers');
  });

  it('manual (non-numeric) checks are surfaced to the caller', () => {
    const r = evaluateVideoFilter(VIDEO_NEW_PAIRS, clean);
    expect(r.manualChecks.length).toBe(VIDEO_MANUAL_CHECKS.length);
    expect(r.manualChecks.some((m) => m.toLowerCase().includes('chart'))).toBe(true);
  });
});
