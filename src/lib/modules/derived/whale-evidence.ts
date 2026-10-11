// ─────────────────────────────────────────────────────────────
// Pure whale evidence builder — no network, no DB.
// Produces sanitized WhaleEvidence + metadata for the classifier.
// ─────────────────────────────────────────────────────────────
import { WhaleEvidence, ResolvedSmartMoneyConfig } from './wallet-intel';

export interface PositionSnapshot {
  mint: string;
  valueUsd: number | null;
  measuredAt: number | null;
  source: string;
  completeness: 'complete' | 'partial';
  limitations: string[];
}

export interface PortfolioSnapshot {
  totalUsd: number | null;
  measuredAt: number | null;
  source: string;
  completeness: 'complete' | 'partial' | 'historical' | 'current-only';
  limitations: string[];
}

export interface BuyVolume30dInput {
  legs: Array<{
    ts: number;
    usd: number | null;
    completeness: 'complete' | 'partial';
    hasHistoricalUsd: boolean;
  }>;
  windowMs: number;
  now: number;
}

export interface BuildWhaleResult {
  evidence: WhaleEvidence;
  metadata: {
    measuredAt: number | null;
    source: string;
    freshness: 'fresh' | 'stale' | 'missing';
    completeness: 'complete' | 'partial' | 'missing';
    limitations: string[];
  };
  gates: {
    maxSinglePositionUsd: boolean;
    portfolioUsd: boolean;
    buyVolume30dUsd: boolean;
    contextMcapUsd: boolean;
  };
}

/** Normalize freshness label based on age and completeness. */
function freshnessOf(measuredAt: number | null, completeness: string, now: number): 'fresh' | 'stale' | 'missing' {
  if (measuredAt === null) return 'missing';
  const ageMs = now - measuredAt;
  const sixHours = 6 * 60 * 60 * 1000;
  if (ageMs > sixHours || completeness === 'partial' || completeness === 'current-only') return 'stale';
  return 'fresh';
}

/** Sum only verified historical USD buy legs within window. */
function sumVerifiedBuyVolume(input: BuyVolume30dInput): number | null {
  const cutoff = input.now - input.windowMs;
  let hasAny = false;
  let sum = 0;
  for (const leg of input.legs) {
    if (leg.ts >= cutoff && leg.usd !== null && leg.completeness === 'complete' && leg.hasHistoricalUsd) {
      sum += leg.usd;
      hasAny = true;
    }
  }
  return hasAny ? sum : null;
}

/** Pick largest verified single position. */
function pickMaxVerifiedPosition(positions: PositionSnapshot[]): number | null {
  let max: number | null = null;
  for (const p of positions) {
    if (p.valueUsd !== null && p.completeness === 'complete') {
      max = max === null ? p.valueUsd : Math.max(max, p.valueUsd);
    }
  }
  return max;
}

/** Build pure whale evidence for the classifier. */
export function buildWhaleEvidence(
  positions: PositionSnapshot[],
  portfolio: PortfolioSnapshot,
  buyVolume30d: BuyVolume30dInput,
  contextMcapUsd: number | null,
  config: ResolvedSmartMoneyConfig,
  now = Date.now(),
): BuildWhaleResult {
  const limitations: string[] = [];

  const maxSinglePositionUsd = pickMaxVerifiedPosition(positions);
  if (maxSinglePositionUsd === null && positions.length > 0) {
    limitations.push('no verified single position (all stale/partial/missing USD)');
  }

  const portfolioUsd = portfolio.totalUsd;
  if (portfolioUsd === null) {
    limitations.push('portfolio value missing or unverified');
  }
  if (portfolio.completeness === 'current-only') {
    limitations.push('portfolio marked current-only, not historical');
  }
  if (portfolio.completeness === 'partial') {
    limitations.push('portfolio completeness partial');
  }

  const buyVolume30dUsd = sumVerifiedBuyVolume(buyVolume30d);
  if (buyVolume30dUsd === null) {
    limitations.push('30d buy volume missing or lacks complete historical USD');
  }
  if (buyVolume30d.legs.some((l) => l.completeness === 'partial' || !l.hasHistoricalUsd)) {
    limitations.push('some buy legs have partial completeness or missing historical USD');
  }

  const contextMcapUsdFinal = contextMcapUsd;
  if (contextMcapUsdFinal === null) {
    limitations.push('context market cap unavailable');
  }

  const evidence: WhaleEvidence = {
    maxSinglePositionUsd,
    portfolioUsd,
    buyVolume30dUsd,
    contextMcapUsd: contextMcapUsdFinal,
  };

  const freshness = freshnessOf(
    portfolio.measuredAt ?? positions[0]?.measuredAt ?? null,
    portfolio.completeness,
    now,
  );

  const completeness =
    maxSinglePositionUsd !== null && portfolioUsd !== null && buyVolume30dUsd !== null
      ? 'complete'
      : maxSinglePositionUsd !== null || portfolioUsd !== null || buyVolume30dUsd !== null
        ? 'partial'
        : 'missing';

  const gates = {
    maxSinglePositionUsd: maxSinglePositionUsd !== null && maxSinglePositionUsd >= config.whaleSinglePositionUsd,
    portfolioUsd: portfolioUsd !== null && portfolioUsd >= config.whalePortfolioUsd,
    buyVolume30dUsd: buyVolume30dUsd !== null && buyVolume30dUsd >= config.whaleBuyVolume30dUsd,
    contextMcapUsd: contextMcapUsdFinal !== null,
  };

  return {
    evidence,
    metadata: {
      measuredAt: now,
      source: 'pure-builder',
      freshness,
      completeness,
      limitations,
    },
    gates,
  };
}

/** Convenience wrapper for tests and direct classifier feeding. */
export function buildWhaleEvidenceSimple(
  maxSinglePositionUsd: number | null,
  portfolioUsd: number | null,
  buyVolume30dUsd: number | null,
  contextMcapUsd: number | null,
): WhaleEvidence {
  return {
    maxSinglePositionUsd,
    portfolioUsd,
    buyVolume30dUsd,
    contextMcapUsd,
  };
}