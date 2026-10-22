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
//   2. knownMigrations >= serialMinTokens && migrations === 0
//                                      → SERIAL_RUGGER
//      (deployed 3+ judged tokens, none ever migrated = never serious)
//   3. ruggedCount >= ruggedSerialMin  → SERIAL_RUGGER
//   4. migrationRate < suspectRateMax && knownMigrations >= suspectMinTokens
//                                      → SUSPECT
//      (migrationRate = migrations / knownMigrations)
//   5. otherwise                       → CLEAN
//
// The verdict reports previousTokens, matureTokens and knownMigrations, so a
// rejection can say how many tokens were set aside and why instead of hiding
// that evidence. Two unreported deployments therefore cannot earn
// SERIAL_RUGGER: the verdict demands three tokens the record actually covers.
// UNPROVEN ≠ CLEAN. SUSPECT ≠ banned. SERIAL_RUGGER = hard reject.
// ─────────────────────────────────────────────────────────────

/** Every threshold, as a concrete contract (no literal-typed spread). */
export interface ResolvedDevHistoryConfig {
  /** Min deployed tokens before a 0-migration dev is called a rugger. */
  serialMinTokens: number
  /** Rugged tokens at which the dev is called a serial rugger. */
  ruggedSerialMin: number
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
  ruggedSerialMin: 2,
  suspectRateMax: 0.34,
  suspectMinTokens: 2,
  matureMinAgeSeconds: 3_600, // 1 hour — younger tokens cannot be judged on migration failure
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

  // 2. 3+ mature deploys with a reported record, zero migrations — never
  // finished anything seriously. Tokens with an unreported outcome cannot
  // support this verdict, so two deployments are not enough to earn it.
  if (knownMigrations >= C.serialMinTokens && migrations === 0) {
    return {
      tier: 'SERIAL_RUGGER',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `${knownMigrations} mature prior tokens with a reported outcome (out of ${previousTokens} total) and 0 ever migrated (threshold: >=${C.serialMinTokens} known outcomes, 0 migrations)`,
      ],
    };
  }

  // 3. Multiple rugged tokens — repeat offender.
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

  // 4. Low migration rate across a meaningful mature sample.
  if (
    migrationRate !== null &&
    migrationRate < C.suspectRateMax &&
    matureTokensCount >= C.suspectMinTokens
  ) {
    return {
      tier: 'SUSPECT',
      previousTokens,
      matureTokens: matureTokensCount,
      knownMigrations,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `migration rate ${migrationRate} < ${C.suspectRateMax} across ${knownMigrations} mature deploys with a reported outcome (out of ${previousTokens} total, threshold: >=${C.suspectMinTokens})`,
      ],
    };
  }

  // 5. Everything else.
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
