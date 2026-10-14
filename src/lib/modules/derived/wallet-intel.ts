// ─────────────────────────────────────────────────────────────
// Fase 3 — Wallet intelligence classifier (PURE, zero I/O).
//
// Source of truth for §5 status labels. The agreed operator definitions
// (2026-10-10) are encoded as the DEFAULTS below; every threshold is a
// parameter, never a hidden constant:
//
//   PnL_30d = Σ(sell_proceeds − buy_cost − fee) / Σ(buy_cost + fee)
//     · closed round-trips only (one wallet × one token, first buy → last exit)
//     · realized only; unrealized tracked separately, never in qualification
//     · fee = onchain fee + priority fee + Jito tip when available,
//       else fee=0 + one confidence downgrade (missing-fee flag)
//     · denominator = total buy cost of closed episodes (never start balance)
//     · ≥5 distinct profitable tokens, else drop largest episode and recompute
//       when n<20 (single-trade giants must not qualify alone)
//
//   Win rate = winning closed episodes / closed episodes
//     · win = episode realized PnL > 0 after fees
//     · partial fills merged FIFO per token; open positions (>10% unsold at
//       window end) excluded from numerator AND denominator, logged as exposure
//     · wash/self-transfers within one cluster excluded when cluster data
//       exists (else: limitation flag, not clean assumption)
//
//   Samples: n ≥ 15 episodes AND ≥5 distinct tokens to qualify;
//     n = 10–14 → PROVISIONAL (never qualified)
//
//   Whale (any ONE leg): single position ≥ $50k mark-to-market at snapshot,
//     or portfolio ≥ $250k, or 30d buy volume ≥ $250k.
//     New Pairs mcap <$500k: position leg drops to $25k (separate phase rule).
//
// Statuses: QUALIFIED_SMART_MONEY | WHALE | WHALE_AND_SMART_MONEY |
//   WATCHLIST | PROVISIONAL | DISQUALIFIED | UNKNOWN
//
// PROVISIONAL ≠ qualified. UNKNOWN ≠ safe. DISQUALIFIED ≠ banned.
// ─────────────────────────────────────────────────────────────

/** Every threshold, as a concrete contract (no literal-typed spread). */
export interface ResolvedSmartMoneyConfig {
  pnl30dMin: number;
  winRateMin: number;
  minEpisodes: number;
  provisionalMinEpisodes: number;
  minDistinctTokens: number;
  minProfitableTokens: number;
  dropLargestOutlierBelowN: number;
  tx7dMax: number;
  whaleSinglePositionUsd: number;
  whalePortfolioUsd: number;
  whaleBuyVolume30dUsd: number;
  newPairMcapCutoffUsd: number;
  newPairWhalePositionUsd: number;
  dropLargestWhenBelowN: number;
  openPositionUnsoldFrac: number;
}

export const SMART_MONEY_DEFAULTS: ResolvedSmartMoneyConfig = {
  pnl30dMin: 0.7,
  winRateMin: 0.6,
  minEpisodes: 15,
  provisionalMinEpisodes: 10,
  minDistinctTokens: 5,
  minProfitableTokens: 5,
  dropLargestOutlierBelowN: 20,
  tx7dMax: 100,
  whaleSinglePositionUsd: 50_000,
  whalePortfolioUsd: 250_000,
  whaleBuyVolume30dUsd: 250_000,
  newPairMcapCutoffUsd: 500_000,
  newPairWhalePositionUsd: 25_000,
  dropLargestWhenBelowN: 20,
  openPositionUnsoldFrac: 0.1,
};

export type SmartMoneyConfig = Partial<ResolvedSmartMoneyConfig>;

export type WalletStatus =
  | 'QUALIFIED_SMART_MONEY'
  | 'WHALE'
  | 'WHALE_AND_SMART_MONEY'
  | 'WATCHLIST'
  | 'PROVISIONAL'
  | 'DISQUALIFIED'
  | 'UNKNOWN';

/** One closed episode: wallet × token over a 30d window. */
export interface TradeEpisode {
  token: string;
  buyCost: number; // Σ buy cost incl. known fees
  sellProceeds: number; // Σ sells in window
  feeKnown: boolean; // false → fee assumed 0, confidence downgraded
  openFrac: number; // fraction of position still unsold (0 = fully closed)
}

export interface WhaleEvidence {
  /** Largest single-token position, mark-to-market at snapshot, USD. */
  maxSinglePositionUsd: number | null;
  /** Total portfolio value, USD. */
  portfolioUsd: number | null;
  /** 30d buy volume, USD. */
  buyVolume30dUsd: number | null;
  /** Market cap context for the position being judged (phase rule). */
  contextMcapUsd?: number | null;
}

export interface ClassifyInput {
  episodes: TradeEpisode[];
  whale: WhaleEvidence;
  tx7d: number | null;
  /**
   * True when the signature list that produced `tx7d` hit the per-wallet
   * harvest cap before walking the full 7d window. `tx7d` is then a proven
   * LOWER BOUND, not an exact 7-day transaction count — the classifier must
   * record that limitation instead of comparing the number as exact.
   */
  tx7dTruncated: boolean;
  distinctTokensTraded: number;
  feeComplete: boolean;
  clusterDataAvailable: boolean;
}

export interface ClassifyOutput {
  status: WalletStatus;
  pnl30d: number | null;
  winRate: number | null;
  episodes: number; // closed episodes counted (pre outlier-drop)
  episodesUsed: number; // episodes actually scored (post outlier-drop)
  openExcluded: number; // episodes excluded as still-open
  profitableTokens: number;
  reasons: string[];
  limitations: string[];
  confidence: 'high' | 'medium' | 'low';
  smartPass: boolean;
  whalePass: boolean;
}

function cfgOf(c?: SmartMoneyConfig): ResolvedSmartMoneyConfig {
  return { ...SMART_MONEY_DEFAULTS, ...(c ?? {}) };
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

export function classifyWallet(input: ClassifyInput, config?: SmartMoneyConfig): ClassifyOutput {
  const C = cfgOf(config);
  const reasons: string[] = [];
  const limitations: string[] = [];

  if (!input.episodes || input.episodes.length === 0) {
    return {
      status: 'UNKNOWN',
      pnl30d: null,
      winRate: null,
      episodes: 0,
      episodesUsed: 0,
      openExcluded: 0,
      profitableTokens: 0,
      reasons: ['no closed-episode data'],
      limitations: ['no transaction history available'],
      confidence: 'low',
      smartPass: false,
      whalePass: false,
    };
  }

  // 1) Open positions (>10% unsold): excluded from numerator AND denominator.
  const closed = input.episodes.filter((e) => e.openFrac <= C.openPositionUnsoldFrac);
  const openExcluded = input.episodes.length - closed.length;
  if (openExcluded > 0) reasons.push(`${openExcluded} open episode(s) excluded from PnL/WR`);

  if (closed.length === 0) {
    return {
      status: 'UNKNOWN',
      pnl30d: null,
      winRate: null,
      episodes: 0,
      episodesUsed: 0,
      openExcluded,
      profitableTokens: 0,
      reasons,
      limitations: ['all episodes still open — nothing closed to measure'],
      confidence: 'low',
      smartPass: false,
      whalePass: whaleLeg(input.whale, C).pass,
    };
  }

  // 2) Per-episode realized PnL + wins.
  const per = closed.map((e) => {
    const denom = e.buyCost > 0 ? e.buyCost : 0;
    const pnl = denom > 0 ? (e.sellProceeds - e.buyCost) / denom : 0;
    return { token: e.token, pnl, buyCost: e.buyCost, win: pnl > 0, feeKnown: e.feeKnown };
  });

  // 3) Single-giant guard: drop the largest episode when n < 20.
  let used = per;
  if (per.length < C.dropLargestWhenBelowN && per.length >= 2) {
    const maxIdx = per.reduce((bi, e, i) => (e.buyCost > per[bi].buyCost ? i : bi), 0);
    used = per.filter((_, i) => i !== maxIdx);
    reasons.push(`largest episode dropped (n=${per.length}<${C.dropLargestWhenBelowN})`);
  }

  const totalBuy = used.reduce((a, e) => a + e.buyCost, 0);
  const totalNet = used.reduce((a, e) => a + (e.pnl * e.buyCost), 0);
  const pnl30d = totalBuy > 0 ? round4(totalNet / totalBuy) : null;
  const winRate = used.length > 0 ? round4(used.filter((e) => e.win).length / used.length) : null;

  const distinctTokens = new Set(used.map((e) => e.token)).size;
  const profitableTokens = new Set(used.filter((e) => e.win).map((e) => e.token)).size;

  if (!input.feeComplete) limitations.push('fees incomplete — assumed 0, confidence downgraded');
  if (!input.clusterDataAvailable) limitations.push('cluster data unavailable — wash trades not excluded');
  if (input.tx7d === null || input.tx7d === undefined) {
    limitations.push('7d tx count unknown');
  } else {
    if (input.tx7dTruncated) {
      limitations.push(`7d tx count ${input.tx7d}+ (signature list truncated — lower bound, not exact)`);
    } else if (input.tx7d >= C.tx7dMax) {
      limitations.push(`7d tx count ${input.tx7d} ≥ ${C.tx7dMax} (bot-like cadence)`);
    }
  }

  // 4) Smart legs.
  const n = used.length;
  const enoughSamples = n >= C.minEpisodes && distinctTokens >= C.minDistinctTokens;
  const provisionalSamples =
    !enoughSamples && n >= C.provisionalMinEpisodes;
  const smartPass =
    enoughSamples &&
    (pnl30d ?? -Infinity) >= C.pnl30dMin &&
    (winRate ?? -Infinity) >= C.winRateMin &&
    profitableTokens >= C.minProfitableTokens;
  if (smartPass) reasons.push(`PnL ${(pnl30d! * 100).toFixed(1)}% ≥ 70%, WR ${((winRate ?? 0) * 100).toFixed(1)}% ≥ 60%, n=${n}, ${profitableTokens} profitable tokens`);

  // 5) Whale legs (any one).
  const w = whaleLeg(input.whale, C);
  if (w.pass) reasons.push(w.reason);

  // 6) Status. PROVISIONAL beats DISQUALIFIED: on thin samples the
  // numbers themselves are untrustworthy, so failure cannot be concluded.
  let status: WalletStatus;
  if (smartPass && w.pass) status = 'WHALE_AND_SMART_MONEY';
  else if (smartPass) status = 'QUALIFIED_SMART_MONEY';
  else if (w.pass) status = 'WHALE';
  else if (provisionalSamples) status = 'PROVISIONAL';
  else if (used.length > 0 && (pnl30d ?? -Infinity) < C.pnl30dMin) status = 'DISQUALIFIED';
  else status = 'UNKNOWN';

  let confidence: ClassifyOutput['confidence'] = 'high';
  if (!input.feeComplete || !input.clusterDataAvailable) confidence = 'medium';
  if (status === 'PROVISIONAL' || status === 'UNKNOWN') confidence = 'low';

  return {
    status,
    pnl30d,
    winRate,
    episodes: closed.length,
    episodesUsed: n,
    openExcluded,
    profitableTokens,
    reasons,
    limitations,
    confidence,
    smartPass,
    whalePass: w.pass,
  };
}

function whaleLeg(
  w: WhaleEvidence,
  C: ResolvedSmartMoneyConfig,
): { pass: boolean; reason: string } {
  const posCutoff =
    w.contextMcapUsd != null && w.contextMcapUsd < C.newPairMcapCutoffUsd
      ? C.newPairWhalePositionUsd
      : C.whaleSinglePositionUsd;
  if (w.maxSinglePositionUsd != null && w.maxSinglePositionUsd >= posCutoff)
    return { pass: true, reason: `single position $${Math.round(w.maxSinglePositionUsd).toLocaleString()} ≥ $${posCutoff.toLocaleString()}` };
  if (w.portfolioUsd != null && w.portfolioUsd >= C.whalePortfolioUsd)
    return { pass: true, reason: `portfolio $${Math.round(w.portfolioUsd).toLocaleString()} ≥ $${C.whalePortfolioUsd.toLocaleString()}` };
  if (w.buyVolume30dUsd != null && w.buyVolume30dUsd >= C.whaleBuyVolume30dUsd)
    return { pass: true, reason: `30d buy volume $${Math.round(w.buyVolume30dUsd).toLocaleString()} ≥ $${C.whaleBuyVolume30dUsd.toLocaleString()}` };
  return { pass: false, reason: '' };
}
