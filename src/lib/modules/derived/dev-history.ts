// ─────────────────────────────────────────────────────────────
// Fase anti-rug — Developer history classifier (PURE, zero I/O).
//
// Decision module for the dev-tokens endpoint (caller fetches the data,
// e.g. via solpump/dev-tokens.ts; this module only judges it). All rules
// are encoded as DEFAULTS below; every threshold is a parameter.
//
// Input: one developer + the full history of tokens they ever deployed
// (from GET /api/v2/token/{chain}/{address}/dev-tokens).
//
// Rules (evaluated in order, first match wins):
//   0. Exclude tokens the developer's record cannot speak to:
//      - younger than matureMinAgeSeconds and not yet migrated (no time to
//        migrate — counting them as failures invents guilt out of missing time)
//      - `migrated` unreported (null: upstream never said, so it can neither
//        prove nor disprove a migration)
//   1. matureTokens === 0              → UNPROVEN
//      (nothing has had time to mature — NOT safe by default)
//   2. ruggedCount >= ruggedSerialMin  → SERIAL_RUGGER
//   3. ruggedCount >= ruggedSuspectMin → SUSPECT
//   4. migrations === 0 && knownMigrations >= serialMinTokens
//      && P(0 migrations | honest dev) < serialMaxBaselineP
//                                      → SERIAL_RUGGER
//   5. migrationRate < suspectRateMax && knownMigrations >= suspectMinTokens
//      → SUSPECT
//   6. otherwise                       → CLEAN
//
// Rule 4 is a BINOMIAL TEST, not a raw count. Bonding-curve launches migrate
// with probability ≈1/70 (baselineMigrationRate), so "0 of N migrated" is the
// NORMAL outcome for an honest dev: P(0 of 3) = 95.8%, P(0 of 20) = 75%. Only
// a sample whose zero-migration streak is improbable under that baseline
// (n ≈ 209 at the default 0.05) is evidence of a rugger, and migration is
// never mentioned again below that bar. `0/N` alone proves nothing.
//
// Migration failure is NOT the rug signal either: a launch that dies
// silently is the ordinary life cycle of this market. Rug behaviour is
// only ever asserted from an explicit rugged flag (rules 2/3), which this
// endpoint currently never reports — so in practice the classifier judges
// outcome coverage and stays silent about fraud it cannot see.
//
// The verdict reports previousTokens, matureTokens and knownMigrations, so a
// rejection can say how many tokens were set aside and why instead of hiding
// that evidence. UNPROVEN ≠ CLEAN. SUSPECT ≠ banned. SERIAL_RUGGER = hard reject.

/** Every threshold, as a concrete contract (no literal-typed spread). */
export interface ResolvedDevHistoryConfig {
  /**
   * Known-outcome sample at which a zero-migration streak is called a
   * rugger pattern. Together with serialMaxBaselineP this is a binomial
   * test on the population migration rate, not a raw token count.
   */
  serialMinTokens: number
  /** Probability of an all-zero streak, for an honest dev, that still counts as luck. */
  serialMaxBaselineP: number
  /** Population migration rate for launches on this launchpad. */
  baselineMigrationRate: number
  /** Rugged tokens at which the dev is called a serial rugger. */
  ruggedSerialMin: number
  /** Rugged tokens at which the dev is flagged SUSPECT (hard reject, not evidence). */
  ruggedSuspectMin: number
  /** Migration rate below which a dev with >= suspectMinTokens is suspect. */
  suspectRateMax: number
  /** Min judged tokens for the suspect-rate rule to apply. */
  suspectMinTokens: number
  /**
   * Age at which a token is old enough to have migrated. Younger tokens are
   * set aside: their "not migrated yet" says nothing about the developer.
   */
  matureMinAgeSeconds: number
}

export const DEV_HISTORY_DEFAULTS: ResolvedDevHistoryConfig = {
  serialMinTokens: 3,
  serialMaxBaselineP: 0.05,
  baselineMigrationRate: 1 / 70,
  ruggedSerialMin: 2,
  ruggedSuspectMin: 1,
  suspectRateMax: 0.34,
  suspectMinTokens: 2,
  matureMinAgeSeconds: 3_600,
};

export type DevHistoryConfig = Partial<ResolvedDevHistoryConfig>;

export type DevHistoryTier =
  | 'CLEAN'
  | 'UNPROVEN'
  | 'SUSPECT'
  | 'SERIAL_RUGGER';

/**
 * One deployed token from the dev-tokens endpoint (subset we judge on).
 * `migrated: null` means the upstream never reported the field — that token is
 * excluded from the migration math instead of being read as "did not migrate".
 */
export interface DevHistoryToken {
  tokenAddress: string
  migrated: boolean | null
  migrationPct: number | null
  rugged?: boolean
  createdAtAgeSeconds?: number | null
}

/** Input: the dev-tokens endpoint payload (caller does the fetching). */
export interface DevHistoryInput {
  devAddress: string | null
  tokens: DevHistoryToken[]
}

/** Output verdict — concrete types, no ReturnType. */
export interface DevHistoryVerdict {
  tier: DevHistoryTier
  /** All tokens the dev has ever deployed (input length). */
  previousTokens: number
  /** Tokens old enough (or already migrated) to be judged on migration. */
  matureTokens: number
  /** Tokens whose migration outcome upstream actually reported. */
  knownMigrations: number
  /** Tokens that completed the bonding-curve migration. */
  migrations: number
  /** migrations / knownMigrations; null when no outcome was reported. */
  migrationRate: number | null
  /** Tokens explicitly flagged rugged. */
  ruggedCount: number
  /** Always non-empty — every tier carries explicit reasoning. */
  reasons: string[]
}

export interface ZeroStreakTest {
  /** Deploys the streak is measured over. */
  n: number
  /** Zero-migration outcomes in that sample. */
  k: number
  /** P(X <= k) under the honest baseline — the one-sided p-value. */
  p: number
}

export function binomCdf(n: number, k: number, p: number): number {
  if (n <= 0) return 1
  const q = 1 - p
  let term = Math.pow(q, n)
  let total = term
  for (let i = 1; i <= k && i <= n; i++) {
    term = (term * (n - i + 1) * p) / (i * q)
    total += term
  }
  return Math.min(1, total)
}

/**
 * One-sided probability of seeing `k` or fewer migrations in `n` judged
 * deploys when the true rate is `baseline`. `priorOnly` restricts the sample
 * to the previousTokens n-1 deploys (the token being judged never migrated
 * yet by construction, so leaving it in biases the rate toward zero).
 */
export function zeroRun(
  knownMigrations: number,
  migrations: number,
  baseline: number,
  priorOnly?: number,
): ZeroStreakTest {
  const n = priorOnly ?? knownMigrations
  const k = Math.max(0, migrations - (knownMigrations - n))
  return { n, k, p: binomCdf(n, k, baseline) }
}

function fmtPct(x: number): string {
  const pct = x * 100
  if (pct === 0) return '0%'
  if (pct < 0.01) return pct.toExponential(1) + '%'
  if (pct < 1) return pct.toFixed(2) + '%'
  return pct.toFixed(1) + '%'
}

/**
 * Classify a developer by their deploy history. Never throws; malformed
 * token entries are counted as not migrated / not rugged.
 */
export function assessDevHistory(
  input: DevHistoryInput,
  config?: DevHistoryConfig,
): DevHistoryVerdict {
  // Merge caller overrides over the documented defaults.
  const C: ResolvedDevHistoryConfig = {
    ...DEV_HISTORY_DEFAULTS,
    ...(config ?? {}),
  };
  const tokens = Array.isArray(input?.tokens) ? input.tokens : [];
  const previousTokens = tokens.length;
  // A token younger than matureMinAgeSeconds has not had the time to migrate;
  // treating it as a failed migration invents guilt out of missing time.
  const matureTokensList = tokens.filter((t) => {
    if (!t) return false;
    if (t.migrated) return true; // migrated tokens count regardless of age
    if (t.createdAtAgeSeconds == null || !Number.isFinite(t.createdAtAgeSeconds)) return true;
    return t.createdAtAgeSeconds >= C.matureMinAgeSeconds;
  });
  const matureTokensCount = matureTokensList.length;
  // An unreported outcome is not a failed migration: only tokens whose
  // `migrated` field upstream actually sent can prove or disprove a migration.
  const knownMigrations = matureTokensList.filter((t) => t.migrated !== null).length;
  const migrations = tokens.filter((t) => t && t.migrated === true).length;
  const ruggedCount = tokens.filter((t) => t && t.rugged === true).length;
  const migrationRate =
    knownMigrations > 0
      ? Math.round((migrations / knownMigrations) * 10_000) / 10_000
      : null;

  // 1. Brand-new dev — nothing to judge.
  if (previousTokens === 0) {
    return {
      tier: 'UNPROVEN',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        'dev has no deploy history — cannot assess rug risk (UNPROVEN ≠ CLEAN)',
      ],
    };
  }
  // 0b. History exists but none of it has had time to mature — nothing to judge.
  // Falling through here would score "0 migrations out of 0 mature tokens" as
  // CLEAN, which is the opposite error of the SERIAL_RUGGER false positive.
  if (matureTokensCount === 0) {
    return {
      tier: 'UNPROVEN',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `${previousTokens} token(s) deployed but none older than ${C.matureMinAgeSeconds}s — migration record is not yet measurable (UNPROVEN ≠ CLEAN)`,
      ],
    };
  }

  // 2. Policy decision, not evidence: a dev with several rugged deploys is
  // refused outright. The rugged flag is an explicit rug report, which is the
  // only outcome that can witness rug behaviour; migration failure cannot.
  if (ruggedCount >= C.ruggedSerialMin) {
    return {
      tier: 'SERIAL_RUGGER',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `${ruggedCount} of ${previousTokens} prior tokens rugged (threshold: >=${C.ruggedSerialMin})`,
      ],
    };
  }

  // 3. One rugged deploy is a risk flag, not a conviction: the dev is held on
  // the watchlist instead of being refused. Same limit as a zero-migration
  // streak that has not yet cleared the binomial bar (rule 4).
  if (ruggedCount >= C.ruggedSuspectMin) {
    return {
      tier: 'SUSPECT',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `${ruggedCount} of ${previousTokens} prior tokens rugged (watchlist threshold: >=${C.ruggedSuspectMin}, hard limit >=${C.ruggedSerialMin}) — risk flag, not a conviction`,
      ],
    };
  }

  // 4. Binomial test on the population migration rate. A zero streak is only
  // evidence once it is improbable for an honest dev, and the bar scales with
  // the sample: 20 launches at a 1.4% base rate still leave an honest dev
  // with a 75% chance of never migrating, so 0/20 says nothing.
  const zeroStreak =
    migrations === 0 && knownMigrations >= C.serialMinTokens
      ? zeroRun(knownMigrations, migrations, C.baselineMigrationRate)
      : null;
  if (zeroStreak && zeroStreak.p < C.serialMaxBaselineP) {
    return {
      tier: 'SERIAL_RUGGER',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `0 of ${knownMigrations} judged tokens migrated (out of ${previousTokens} total); at the ${fmtPct(C.baselineMigrationRate)} baseline that streak happens in ${fmtPct(zeroStreak.p)} of honest devs (limit ${fmtPct(C.serialMaxBaselineP)})`,
      ],
    };
  }

  // 5. One-sided exact test on the migration RATE, with the honest baseline as
  // the null hypothesis. Comparing the observed rate against a fixed fraction
  // would flag every dev on a launchpad where migration is rare; excluding
  // today's token keeps the sample limited to prior deploys.
  if (knownMigrations >= C.suspectMinTokens) {
    const priorStreak = zeroRun(
      knownMigrations,
      migrations,
      C.baselineMigrationRate,
      previousTokens,
    );
    if (priorStreak.p < C.serialMaxBaselineP) {
      return {
        tier: 'SUSPECT',
        previousTokens,
        matureTokens: matureTokensCount,
        knownMigrations,
        migrations,
        migrationRate,
        ruggedCount,
        reasons: [
          `${migrations} of ${knownMigrations} judged tokens migrated (${migrationRate ?? 'n/a'} rate, prior deploys only ${migrations}/${priorStreak.n}); at the ${fmtPct(C.baselineMigrationRate)} baseline that is a ${fmtPct(priorStreak.p)} outcome — thin record (UNPROVEN ≠ CLEAN)`,
        ],
      };
    }
  }

  if (zeroStreak) {
    return {
      tier: 'UNPROVEN',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `0 of ${knownMigrations} judged tokens migrated: normal for this launchpad (${fmtPct(zeroStreak.p)} of honest devs do the same, limit ${fmtPct(C.serialMaxBaselineP)}) — not evidence of fraud, but nothing migrated either (UNPROVEN ≠ CLEAN)`,
      ],
    };
  }
  return {
    tier: 'CLEAN',
    previousTokens,
    matureTokens: matureTokensCount,
    knownMigrations,
    migrations,
    migrationRate,
    ruggedCount,
    reasons: [
      `${previousTokens} prior token(s), ${migrations} migrated of ${knownMigrations} with a reported outcome (${migrationRate ?? 'n/a'} rate), ${ruggedCount} rugged — no red flags`,
    ],
  };
}

/** Sniper-gate mapping: CLEAN/UNPROVEN pass, the rest are rejected. */
export function toSniperGate(verdict: DevHistoryVerdict): {
  ok: boolean
  rejection?: string
} {
  switch (verdict.tier) {
    case 'CLEAN':
    case 'UNPROVEN':
      return { ok: true };
    case 'SUSPECT':
      return { ok: false, rejection: 'dev_history_suspect' };
    case 'SERIAL_RUGGER':
      return { ok: false, rejection: 'dev_serial_scammer' };
  }
}
