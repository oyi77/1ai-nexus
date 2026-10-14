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
//   1. previousTokens === 0            → UNPROVEN
//      (dev is brand new — no history to judge, NOT safe by default)
//   2. previousTokens >= serialMinTokens && migrations === 0
//                                      → SERIAL_RUGGER
//      (deployed 3+ tokens, none ever migrated = never serious)
//   3. ruggedCount >= ruggedSerialMin  → SERIAL_RUGGER
//   4. migrationRate < suspectRateMax && previousTokens >= suspectMinTokens
//                                      → SUSPECT
//      (migrationRate = migrations / previousTokens; null when no history)
//   5. otherwise                       → CLEAN
//
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
  suspectMinTokens: number
}

export const DEV_HISTORY_DEFAULTS: ResolvedDevHistoryConfig = {
  serialMinTokens: 3,
  ruggedSerialMin: 2,
  suspectRateMax: 0.34,
  suspectMinTokens: 2,
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
  const migrations = tokens.filter((t) => t && t.migrated === true).length;
  const ruggedCount = tokens.filter((t) => t && t.rugged === true).length;
  // Round to 4dp so boundary tests are stable against float artifacts.
  const migrationRate =
    previousTokens > 0
      ? Math.round((migrations / previousTokens) * 10_000) / 10_000
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

  // 2. 3+ deploys, zero migrations — never finished anything seriously.
  if (previousTokens >= C.serialMinTokens && migrations === 0) {
    return {
      tier: 'SERIAL_RUGGER',
      previousTokens,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `${previousTokens} prior tokens deployed and 0 ever migrated (threshold: >=${C.serialMinTokens} deploys, 0 migrations)`,
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

  // 4. Low migration rate across a meaningful sample.
  if (
    migrationRate !== null &&
    migrationRate < C.suspectRateMax &&
    previousTokens >= C.suspectMinTokens
  ) {
    return {
      tier: 'SUSPECT',
      previousTokens,
      migrations,
      migrationRate,
      ruggedCount,
      reasons: [
        `migration rate ${migrationRate} < ${C.suspectRateMax} across ${previousTokens} deploys (threshold: >=${C.suspectMinTokens} deploys)`,
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
