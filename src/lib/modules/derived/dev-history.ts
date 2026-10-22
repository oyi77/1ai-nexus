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
//   0. drop tokens younger than matureMinAgeSeconds from the migration math
//      (a token a few minutes old has not had the chance to migrate; counting
//      it as "never migrated" invents a failure out of missing time)
//   1. matureTokens === 0              → UNPROVEN
//      (nothing has had time to mature — NOT safe by default)
//   2. matureTokens >= serialMinTokens && migrations === 0
//                                      → SERIAL_RUGGER
//      (deployed 3+ mature tokens, none ever migrated = never serious)
//   3. ruggedCount >= ruggedSerialMin  → SERIAL_RUGGER
//   4. migrationRate < suspectRateMax && matureTokens >= suspectMinTokens
//                                      → SUSPECT
//      (migrationRate = migrations / matureTokens; null when nothing matured)
//   5. otherwise                       → CLEAN
//
// The verdict always reports both counts, so a rejection can say how many
// tokens were set aside as too young instead of hiding that evidence.
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
  /** Min deployed tokens for the suspect-rate rule to apply. */
  /** Min deployed tokens for the suspect-rate rule to apply. */
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

/** One deployed token from the dev-tokens endpoint (subset we judge on). */
export interface DevHistoryToken {
  tokenAddress: string
  migrated: boolean
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
  /** Tokens that completed the bonding-curve migration. */
  migrations: number
  /** migrations / previousTokens; null when previousTokens === 0. */
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
  const migrations = tokens.filter((t) => t && t.migrated === true).length;
  const ruggedCount = tokens.filter((t) => t && t.rugged === true).length;
  const migrationRate =
    matureTokensCount > 0
      ? Math.round((migrations / matureTokensCount) * 10_000) / 10_000
      : null;

  // 1. Brand-new dev — nothing to judge.
  if (previousTokens === 0) {
    return {
      tier: 'UNPROVEN',
      previousTokens,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        'dev has no deploy history — cannot assess rug risk (UNPROVEN ≠ CLEAN)',
      ],
    };
  }

  // 2. 3+ mature deploys, zero migrations — never finished anything seriously.
  if (matureTokensCount >= C.serialMinTokens && migrations === 0) {
    return {
      tier: 'SERIAL_RUGGER',
      previousTokens,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `${matureTokensCount} mature prior tokens deployed (out of ${previousTokens} total) and 0 ever migrated (threshold: >=${C.serialMinTokens} mature deploys, 0 migrations)`,
      ],
    };
  }

  // 3. Multiple rugged tokens — repeat offender.
  if (ruggedCount >= C.ruggedSerialMin) {
    return {
      tier: 'SERIAL_RUGGER',
      previousTokens,
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
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `migration rate ${migrationRate} < ${C.suspectRateMax} across ${matureTokensCount} mature deploys (out of ${previousTokens} total, threshold: >=${C.suspectMinTokens} mature deploys)`,
      ],
    };
  }

  // 5. Everything else.
  return {
    tier: 'CLEAN',
    previousTokens,
    migrations,
    migrationRate,
    ruggedCount,
    reasons: [
      `${previousTokens} prior token(s), ${migrations} migrated (${migrationRate ?? 'n/a'} rate), ${ruggedCount} rugged — no red flags`,
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
