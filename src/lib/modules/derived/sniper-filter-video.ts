// ─────────────────────────────────────────────────────────────
// Sniper filter — operator's VIDEO material, TRANSCRIBED source of
// truth (Efandra, "Materi Cara Filter memecoin Potensial naik 2x",
// Drive id 1AB9qSDEYUhxb73AG6Xh_XSCI5fRG4kFh, 472s, transcribed
// locally 2026-10-11 with faster-whisper small/id).
//
// This is the OPERATOR'S OWN FILTER SETTINGS as typed into the tool
// during the video — quoted with timestamps. No threshold invented,
// no averaging. These gate the tool's New-Pairs and Final-Stretch
// tabs specifically (the operator says migrated differs — see note).
//
// Input discipline: normalize once at the boundary; UNKNOWN (null /
// malformed / partial) NEVER passes a gate and NEVER equals 0.
// ─────────────────────────────────────────────────────────────

export type GateVerdict = 'pass' | 'reject' | 'warn' | 'unknown';

export interface GateResult {
  key: string;
  label: string;
  verdict: GateVerdict;
  value: number | boolean | null;
  rule: string;
}

/** Safe numeric coercion at the trust boundary: null/NaN/non-finite -> null. */
export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface VideoFilterMetrics {
  tokenAgeMin?: number | null;
  top10HoldersPct?: number | null;
  devHoldingPct?: number | null;
  sniperPct?: number | null;
  insiderPct?: number | null;
  bundlerPct?: number | null;
  proTraderCount?: number | null;
  marketCapUsd?: number | null;
}

interface BandRule {
  key: string;
  label: string;
  field: keyof VideoFilterMetrics;
  /** inclusive lower bound; null = no min (operator left it unset). */
  min: number | null;
  /** inclusive upper bound; null = no max (operator left it unset). */
  max: number | null;
  unit: string;
  quote: string;
}

/**
 * AMBIGUOUS — operator misspoke on top holders: "top holdersnya itu 50%
 * nih untuk minimalnya, dan maksimalnya kalian set aja di 30%" (l.17-18).
 * A min of 50% with a max of 30% is unsatisfiable, so top-holders is
 * DELIBERATELY NOT a gate here. The other two docs in this repo both say
 * Top 10 < 30%, so use those profiles if you need a top-holders gate.
 * Not silently averaged, not guessed.
 */
export const VIDEO_TOP_HOLDERS_CONTRADICTION =
  'l.17-18 min 50% / max 30% is unsatisfiable (operator misspoke) — no top-holders gate encoded';

/**
 * VIDEO vs PDF (The Eksposure Game p.48) — the operator's LIVE tool
 * settings in the video differ from the PDF's printed table. Both are
 * preserved side by side; never averaged:
 *   dev holding    video 0-0%    vs PDF 0-2%    (video stricter)
 *   snipers        video ≤12%    vs PDF 0-15%   (video stricter)
 *   bundlers       video ≤30%    vs PDF 0-40%   (video stricter)
 *   final age min  video 11 min  vs PDF 10 min  (video stricter)
 *   top holders    video unsatisfiable vs PDF 12-40% early / ≤30% final
 * The video profile wins for video-sourced gating because it is what
 * the operator actually typed; the PDF profile is the PDF's own table.
 */
export const VIDEO_VS_PDF_CONFLICTS = [
  { key: 'dev-holding', video: '0-0%', pdf: '0-2%' },
  { key: 'snipers', video: '≤12%', pdf: '0-15%' },
  { key: 'bundlers', video: '≤30%', pdf: '0-40%' },
  { key: 'final-age-min', video: '11 min', pdf: '10 min' },
  { key: 'top-holders', video: 'unsatisfiable (misspoke)', pdf: '12-40% early / ≤30% final' },
] as const;

/**
 * NEW PAIRS — operator's tool filter.
 * Transcript cites: age max 300 min (l.11); top holders min 50% max 30%
 * (l.17-18, operator misspoke min>max — kept verbatim, see note);
 * dev 0-0% (l.20-21); sniper max 12% (l.23); insider max 8% (l.24);
 * bundle max 30% (l.24); proTrader min 20 (l.25-26); MC ≥ 7000 (l.34).
 */
export const VIDEO_NEW_PAIRS: { id: string; source: string; rules: BandRule[] } = {
  id: 'video-new-pairs',
  source: '1AB9qSDEYUhxb73AG6Xh_XSCI5fRG4kFh',
  rules: [
    { key: 'age', label: 'Token Age', field: 'tokenAgeMin', min: null, max: 300, unit: 'min', quote: 'new plus max 300 menit (l.11)' },
    { key: 'dev-holding', label: 'Dev Holding', field: 'devHoldingPct', min: 0, max: 0, unit: '%', quote: 'minimal 0%, maksimal 0% (l.20-21)' },
    { key: 'snipers', label: 'Snipers', field: 'sniperPct', min: null, max: 12, unit: '%', quote: 'sniper setting di max 12% (l.23)' },
    { key: 'insider', label: 'Insider', field: 'insiderPct', min: null, max: 8, unit: '%', quote: 'insider setting 8% (l.24)' },
    { key: 'bundlers', label: 'Bundlers', field: 'bundlerPct', min: null, max: 30, unit: '%', quote: 'bundle setting 30% (l.24)' },
    { key: 'pro-trader', label: 'Pro Trader', field: 'proTraderCount', min: 20, max: null, unit: '', quote: 'protrader minimal 20 (l.25-26)' },
    { key: 'min-mc', label: 'Market Cap', field: 'marketCapUsd', min: 7_000, max: null, unit: ' USD', quote: 'new plus 7000 (l.34)' },
  ],
};

/**
 * FINAL STRETCH — operator's tool filter. Differs from New Pairs only:
 * age min 11 min (l.14, max 300 same, l.14); MC min $12k (l.35).
 */
export const VIDEO_FINAL_STRETCH: { id: string; source: string; rules: BandRule[] } = {
  id: 'video-final-stretch',
  source: '1AB9qSDEYUhxb73AG6Xh_XSCI5fRG4kFh',
  rules: [
    { key: 'age', label: 'Token Age', field: 'tokenAgeMin', min: 11, max: 300, unit: 'min', quote: 'final start minimal 11 menit, max 300 (l.14)' },
    { key: 'dev-holding', label: 'Dev Holding', field: 'devHoldingPct', min: 0, max: 0, unit: '%', quote: 'dev 0-0% (l.20-21)' },
    { key: 'snipers', label: 'Snipers', field: 'sniperPct', min: null, max: 12, unit: '%', quote: 'sniper max 12% (l.23)' },
    { key: 'insider', label: 'Insider', field: 'insiderPct', min: null, max: 8, unit: '%', quote: 'insider 8% (l.24)' },
    { key: 'bundlers', label: 'Bundlers', field: 'bundlerPct', min: null, max: 30, unit: '%', quote: 'bundle 30% (l.24)' },
    { key: 'pro-trader', label: 'Pro Trader', field: 'proTraderCount', min: 20, max: null, unit: '', quote: 'protrader min 20 (l.25-26)' },
    { key: 'min-mc', label: 'Market Cap', field: 'marketCapUsd', min: 12_000, max: null, unit: ' USD', quote: 'final stretch 12k (l.35)' },
  ],
};

export interface VideoEvaluateResult {
  profile: string;
  verdict: 'pass' | 'reject' | 'watch';
  gates: GateResult[];
  unknowns: string[];
  rejects: string[];
  warns: string[];
  /** Operator's manual checks NOT in the numeric filter (chart, cluster). */
  manualChecks: string[];
}

function bandGate(m: VideoFilterMetrics, r: BandRule): GateResult {
  const v = numOrNull(m[r.field]);
  const lo = r.min === null ? '' : `≥ ${r.min}${r.unit}`;
  const hi = r.max === null ? '' : `≤ ${r.max}${r.unit}`;
  const rule = [lo, hi].filter(Boolean).join(' and ');
  if (v === null) return { key: r.key, label: r.label, verdict: 'unknown', value: null, rule };
  const okMin = r.min === null || v >= r.min;
  const okMax = r.max === null || v <= r.max;
  return { key: r.key, label: r.label, verdict: okMin && okMax ? 'pass' : 'reject', value: v, rule };
}

/**
 * Operator's post-filter manual checks (NOT numeric gates):
 * - chart: avoid tokén already pumped & dumped by twitter-trackers
 *   (l.288-320: "penurunan terlalu dalam", "udah dipake, dibuang").
 * - cluster: check bubble-map / cluster wallet (l.380-382).
 * - entry: pick entry via TA / price psychology after chart+cluster OK
 *   (l.447-458).
 */
export const VIDEO_MANUAL_CHECKS = [
  'Check chart: skip if already pumped then dumped by twitter-trackers (l.288-320).',
  'Check cluster wallet / bubble-map before entry (l.380-382).',
  'Pick entry point via TA / price psychology (l.447-458).',
] as const;

export function evaluateVideoFilter(
  profile: typeof VIDEO_NEW_PAIRS | typeof VIDEO_FINAL_STRETCH,
  m: VideoFilterMetrics,
): VideoEvaluateResult {
  const gates = profile.rules.map((r) => bandGate(m, r));
  const rejects = gates.filter((g) => g.verdict === 'reject').map((g) => `${g.label} (${g.value ?? '?'} vs ${g.rule})`);
  const unknowns = gates.filter((g) => g.verdict === 'unknown').map((g) => g.label);
  const warns: string[] = [];
  const verdict: VideoEvaluateResult['verdict'] =
    rejects.length > 0 ? 'reject' : unknowns.length > 0 || warns.length > 0 ? 'watch' : 'pass';
  return {
    profile: profile.id,
    verdict,
    gates,
    unknowns,
    rejects,
    warns,
    manualChecks: [...VIDEO_MANUAL_CHECKS],
  };
}