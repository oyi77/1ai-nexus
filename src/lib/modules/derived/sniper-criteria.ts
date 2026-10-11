// ─────────────────────────────────────────────────────────────
// Sniper criteria — operator's ebook source of truth (Efandra, 7 docs,
// fetched read-only from operator's Drive folder 1A3hLIJjQ…, 2026-10-11).
//
// PURE, zero I/O. Every threshold below is quoted from a document; the
// doc id is cited inline. No threshold is invented or averaged across
// docs — conflicting numbers live side by side as separate profiles,
// because the ebooks gate DIFFERENT PHASES (launch vs post-bonding vs
// exposure window). Choosing one profile is the caller's job.
//
// Input discipline (learned): normalize once at the boundary; UNKNOWN
// (null / malformed / partial) NEVER passes a gate and NEVER equals 0.
// Missing metric -> gate 'unknown', never 'pass'.
// ─────────────────────────────────────────────────────────────

export type GateVerdict = 'pass' | 'reject' | 'warn' | 'unknown';

export interface GateResult {
  key: string;
  label: string;
  verdict: GateVerdict;
  /** null when verdict is 'unknown'. */
  value: number | boolean | null;
  /** Human-readable threshold actually applied. */
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

/** Boolean with explicit whitelist — no truthy coercion. */
export function boolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

// ─── Metric bag: one flat, already-trusted shape ──────────────
// All fields optional. Missing -> null -> gate 'unknown'.
export interface SniperMetrics {
  devHoldingPct?: number | null;
  sniperPct?: number | null;
  insiderPct?: number | null;
  bundlerPct?: number | null;
  freshWalletPct?: number | null;
  top10HoldersPct?: number | null;
  earlyBuyerPct?: number | null;
  devSnipedPct?: number | null;
  clusterPct?: number | null;
  singleWhalePct?: number | null;
  volumeToMc?: number | null;
  proTraderSharePct?: number | null;
  proTraderCount?: number | null;
  tokenAgeMin?: number | null;
  marketCapUsd?: number | null;
  survivedPostBondingMin?: number | null;
  rugProbabilityPct?: number | null;
  lpBurntPct?: number | null;
  mintEnabled?: boolean | null;
  freezeEnabled?: boolean | null;
  smartWalletPnlPct?: number | null;
  sniperTop1or2Fresh?: boolean | null;
  sniperTop3IsSniper?: boolean | null;
  bubblemapChained?: boolean | null;
}

interface NumRule {
  key: string;
  label: string;
  field: keyof SniperMetrics;
  op: 'lt' | 'lte' | 'gte';
  threshold: number;
  unit: string;
  /** reject when violated (true) vs warn when violated (false). */
  hard: boolean;
}

/** Numeric gate: value missing/NaN -> 'unknown' (never pass, never 0). */
function numGate(m: SniperMetrics, r: NumRule): GateResult {
  const raw = m[r.field];
  const v = numOrNull(raw);
  const rule = `${r.key} ${r.op === 'lt' ? '<' : r.op === 'lte' ? '≤' : '≥'} ${r.threshold}${r.unit}`;
  if (v === null) return { key: r.key, label: r.label, verdict: 'unknown', value: null, rule };
  const ok = r.op === 'lt' ? v < r.threshold : r.op === 'lte' ? v <= r.threshold : v >= r.threshold;
  return { key: r.key, label: r.label, verdict: ok ? 'pass' : r.hard ? 'reject' : 'warn', value: v, rule };
}

interface BoolRule {
  key: string;
  label: string;
  field: keyof SniperMetrics;
  /** required value; mismatch -> reject. */
  required: boolean;
  hard: boolean;
}

function boolGate(m: SniperMetrics, r: BoolRule): GateResult {
  const v = boolOrNull(m[r.field]);
  const rule = `${r.key} must be ${r.required}`;
  if (v === null) return { key: r.key, label: r.label, verdict: 'unknown', value: null, rule };
  return { key: r.key, label: r.label, verdict: v === r.required ? 'pass' : r.hard ? 'reject' : 'warn', value: v, rule };
}

export interface CriteriaProfile {
  id: string;
  doc: string;
  docTitle: string;
  numRules: NumRule[];
  boolRules: BoolRule[];
}

/**
 * PHASE 1 — New Pairs, TF 5m.
 * Doc: "Master Architecture & Logic Specification / Golden Second Engine"
 * (1yT0SY7A…, lines 33-61 + system prompt line 89).
 * This is the doc's own decision matrix — AUTOMATIC SKIP semantics.
 */
export const GOLDEN_NEW_PAIRS: CriteriaProfile = {
  id: 'golden-new-pairs',
  doc: '1yT0SY7ALf9txNsnq4SIPW7kmS1B-Cl8Tpn5BAsqpfFY',
  docTitle: 'Golden Second — Master Architecture (AI Agent Memecoin Analyzer)',
  // doc line 40 + prompt line 89: reject iff >2% → pass iff ≤2%
  numRules: [
    { key: 'dev-holding', label: 'Dev Holding', field: 'devHoldingPct', op: 'lte', threshold: 2, unit: '%', hard: true },
    { key: 'red-snipers', label: 'Red Snipers', field: 'sniperPct', op: 'lt', threshold: 6, unit: '%', hard: true },
    { key: 'bundlers', label: 'Bundlers', field: 'bundlerPct', op: 'lte', threshold: 40, unit: '%', hard: true },
    { key: 'insider', label: 'Insider', field: 'insiderPct', op: 'lt', threshold: 6, unit: '%', hard: true },
    { key: 'cluster', label: 'Bubblemap Cluster', field: 'clusterPct', op: 'lte', threshold: 5, unit: '%', hard: true },
    { key: 'single-whale', label: 'Single Whale', field: 'singleWhalePct', op: 'lte', threshold: 5, unit: '%', hard: true },
    { key: 'vol-mc', label: 'Volume vs MC (TF 5m)', field: 'volumeToMc', op: 'gte', threshold: 2, unit: 'x', hard: false },
  ],
  boolRules: [],
};

/**
 * PHASE 2 — Post-Migrated, TF 1H/24H.
 * Same doc lines 62-81: Fase 1 audit MUST pass first (caller gates
 * that), then volume ≥4x, narrative organic, smart-wallet PnL bands.
 */
export const GOLDEN_POST_MIGRATED: CriteriaProfile = {
  id: 'golden-post-migrated',
  doc: '1yT0SY7ALf9txNsnq4SIPW7kmS1B-Cl8Tpn5BAsqpfFY',
  docTitle: 'Golden Second — Master Architecture (AI Agent Memecoin Analyzer)',
  numRules: [
    { key: 'vol-mc-1h', label: 'Volume vs MC (TF 1H/24H)', field: 'volumeToMc', op: 'gte', threshold: 4, unit: 'x', hard: false },
    // line 77: "Terdeteksi & PnL < +50% (Akumulasi)" / line 78 "PnL > +200% FLAG RED"
    { key: 'smart-wallet-pnl', label: 'Smart Wallet PnL', field: 'smartWalletPnlPct', op: 'lt', threshold: 200, unit: '%', hard: true },
  ],
  boolRules: [],
};

/**
 * SNIPER AT LAUNCH — Pump.fun / Raydium snipe decision.
 * Doc: "Teknik Sniper Memecoin" (1L7rTOCL…, lines 21-40 distribution
 * thresholds, line 9 dev >3% REJECT). Stricter than Golden Second —
 * this is a snipe-time gate, not a 5m screener.
 */
export const SNIPER_LAUNCH: CriteriaProfile = {
  id: 'sniper-launch',
  doc: '1L7rTOCLyM7m-SW2fGvHXoATqO_zr_Wj1VS3RuvhTEc8',
  docTitle: 'Teknik Sniper Memecoin (Efandra)',
  numRules: [
    { key: 'dev-holding', label: 'Dev Holding', field: 'devHoldingPct', op: 'lte', threshold: 3, unit: '%', hard: true },
    { key: 'top10', label: 'Top 10 Holders', field: 'top10HoldersPct', op: 'lt', threshold: 30, unit: '%', hard: true },
    { key: 'insider', label: 'Insider Wallets', field: 'insiderPct', op: 'lt', threshold: 5, unit: '%', hard: true },
    { key: 'bundlers', label: 'Bundlers', field: 'bundlerPct', op: 'lt', threshold: 10, unit: '%', hard: true },
    { key: 'snipers', label: 'Snipers', field: 'sniperPct', op: 'lt', threshold: 7, unit: '%', hard: true },
    { key: 'fresh-wallets', label: 'Fresh Wallets', field: 'freshWalletPct', op: 'lt', threshold: 10, unit: '%', hard: true },
    // line 16: GMGN Rug Probability = 100% -> REJECT
    { key: 'rug-prob', label: 'Rug Probability', field: 'rugProbabilityPct', op: 'lt', threshold: 100, unit: '%', hard: true },
  ],
  boolRules: [
    // lines 47-50: Top1/2 Fresh -> REJECT; Top1-3 Sniper -> REJECT
    { key: 'top12-fresh', label: 'Top 1–2 not Fresh Wallet', field: 'sniperTop1or2Fresh', required: false, hard: true },
    { key: 'top3-sniper', label: 'Top 1–3 not Sniper Wallet', field: 'sniperTop3IsSniper', required: false, hard: true },
    // lines 53-58: chain-linked bubbles -> REJECT
    { key: 'bubblemap-chain', label: 'Bubblemap chain-address links', field: 'bubblemapChained', required: false, hard: true },
  ],
};

/**
 * POST-BONDING — GMGN "Completed" list.
 * Doc: "Cara Screening Memecoin setelah Bonding" (1uDjqHft…,
 * lines 12-14 10-min rule, 40 Top10<30%, 44 early buyers, 51 insider,
 * 55 fresh, 61 sniper, 34 dev sniped>12%, 69-77 LP/Mint/Freeze).
 */
export const BONDING_POST: CriteriaProfile = {
  id: 'bonding-post',
  doc: '1uDjqHft-tIpfvyi4gS-coqCRAk6hJZqq-9Hg-ruysdg',
  docTitle: 'Cara Screening Memecoin setelah Bonding (Efandra)',
  numRules: [
    { key: 'survived-10min', label: 'Survived post-bonding', field: 'survivedPostBondingMin', op: 'gte', threshold: 10, unit: 'min', hard: true },
    { key: 'dev-sniped', label: 'Dev Sniped', field: 'devSnipedPct', op: 'lte', threshold: 12, unit: '%', hard: true },
    { key: 'top10', label: 'Top 10 Holders', field: 'top10HoldersPct', op: 'lt', threshold: 30, unit: '%', hard: true },
    { key: 'early-buyers', label: 'Early Buyers (first 70)', field: 'earlyBuyerPct', op: 'lt', threshold: 20, unit: '%', hard: true },
    { key: 'insider', label: 'Insider', field: 'insiderPct', op: 'lt', threshold: 2, unit: '%', hard: true },
    { key: 'fresh-wallets', label: 'Fresh Wallets', field: 'freshWalletPct', op: 'lt', threshold: 3, unit: '%', hard: true },
    { key: 'snipers', label: 'Snipers (unsold)', field: 'sniperPct', op: 'lt', threshold: 12, unit: '%', hard: true },
    // line 69-71: LP must be 100% burnt (doc: "<90% risky", ideal 100)
    { key: 'lp-burnt', label: 'LP Burnt', field: 'lpBurntPct', op: 'gte', threshold: 100, unit: '%', hard: false },
  ],
  boolRules: [
    // lines 62-77: Mint must be OFF, Freeze must be OFF
    { key: 'mint-off', label: 'Mint disabled', field: 'mintEnabled', required: false, hard: true },
    { key: 'freeze-off', label: 'Freeze disabled', field: 'freezeEnabled', required: false, hard: true },
  ],
};

/**
 * EXPOSURE EARLY — New Pairs scalping window (age 0–120 min).
 * Doc: "The Eksposure Game" (1zfYOwE3…, lines 41-55 parameter bands).
 * Ranges encoded as: pass inside band, warn outside hard bound.
 * Bands are RANGE rules (doc gives min AND max), so gte-min with hard
 * floor and lte-max with hard ceiling.
 */
export const EXPOSURE_EARLY: CriteriaProfile = {
  id: 'exposure-early',
  doc: '1zfYOwE3HIDnZVqsBhQ1xQn0btpccMYaZFRxhfZmN214',
  docTitle: 'The Eksposure Game (Efandra)',
  numRules: [
    { key: 'age-window', label: 'Token age', field: 'tokenAgeMin', op: 'lte', threshold: 120, unit: 'min', hard: false },
    { key: 'top-holders', label: 'Top Holders', field: 'top10HoldersPct', op: 'lte', threshold: 40, unit: '%', hard: true },
    { key: 'dev-holding', label: 'Dev Holding', field: 'devHoldingPct', op: 'lte', threshold: 2, unit: '%', hard: true },
    { key: 'snipers', label: 'Snipers', field: 'sniperPct', op: 'lte', threshold: 15, unit: '%', hard: true },
    { key: 'insider', label: 'Insider', field: 'insiderPct', op: 'lte', threshold: 8, unit: '%', hard: true },
    { key: 'bundlers', label: 'Bundlers', field: 'bundlerPct', op: 'lte', threshold: 40, unit: '%', hard: true },
    // line 48: Pro Trader minimal 20 (count, not share)
    { key: 'pro-trader', label: 'Pro Trader count', field: 'proTraderCount', op: 'gte', threshold: 20, unit: '', hard: false },
    // line 51-52 final stretch: MC ≥ $12K
    { key: 'min-mc', label: 'Market Cap (final stretch)', field: 'marketCapUsd', op: 'gte', threshold: 12_000, unit: ' USD', hard: false },
  ],
  boolRules: [],
};

// ─── Evaluation ───────────────────────────────────────────────

export interface EvaluateResult {
  profile: string;
  verdict: 'pass' | 'reject' | 'watch';
  gates: GateResult[];
  /** Gates with no data (missing/malformed) — never counted as pass. */
  unknowns: string[];
  rejects: string[];
  warns: string[];
}

/**
 * Evaluate one profile over normalized metrics.
 * Verdict: any hard reject -> 'reject'; else any unknown or warn ->
 * 'watch'; else 'pass'. A profile with ALL gates unknown is 'watch'
 * (data absent), never 'pass' — absent data must not read as a pass.
 */
export function evaluateProfile(profile: CriteriaProfile, m: SniperMetrics): EvaluateResult {
  const gates: GateResult[] = [
    ...profile.numRules.map((r) => numGate(m, r)),
    ...profile.boolRules.map((r) => boolGate(m, r)),
  ];
  const rejects = gates.filter((g) => g.verdict === 'reject').map((g) => `${g.label} (${g.value ?? '?'} vs ${g.rule})`);
  const unknowns = gates.filter((g) => g.verdict === 'unknown').map((g) => g.label);
  const warns = gates.filter((g) => g.verdict === 'warn').map((g) => `${g.label} (${g.value ?? '?'} vs ${g.rule})`);
  const verdict: EvaluateResult['verdict'] =
    rejects.length > 0 ? 'reject' : unknowns.length > 0 || warns.length > 0 ? 'watch' : 'pass';
  return { profile: profile.id, verdict, gates, unknowns, rejects, warns };
}

/** Convenience: evaluate every built-in profile at once. */
export const ALL_PROFILES: CriteriaProfile[] = [
  GOLDEN_NEW_PAIRS,
  GOLDEN_POST_MIGRATED,
  SNIPER_LAUNCH,
  BONDING_POST,
  EXPOSURE_EARLY,
];

/** Source docs for provenance — no secrets, public doc ids only. */
export const EBOOK_DOCS = ALL_PROFILES.map((p) => ({ id: p.doc, title: p.docTitle, profile: p.id }));
