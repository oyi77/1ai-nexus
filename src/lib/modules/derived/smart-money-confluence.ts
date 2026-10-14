// ─────────────────────────────────────────────────────────────
// Fase 3 — Smart-money confluence detector (PURE, zero I/O).
//
// Detects "smart money bought the same token within the same time
// window" signals from normalized swap legs.
//
// Definitions (all parameters, no hidden constants):
//   · Buy leg = swap where inputMint === SOL_MINT && outputMint !== SOL_MINT
//     (SOL → token). Sell legs (outputMint === SOL_MINT) never count.
//   · A leg is COUNTED only when: completeness === 'complete' AND
//     inputUsd != null AND inputUsd >= minBuyUsd AND timestamp != null.
//     inputUsd == null → leg skipped entirely (never invent USD).
//   · Wallet is a BUYER when it is in `qualifiedWallets` (the Set comes
//     from the caller — this module never touches the DB).
//   · Window semantics: INCLUSIVE on both ends. A set of legs fits one
//     window iff (maxTs − minTs) <= windowMs. A window anchored at leg i
//     spans exactly the legs with t − t_i <= windowMs. The boundary case
//     t_j − t_i === windowMs IS included (tested).
//   · A window QUALIFIES when it contains >= minQualifiedBuyers DISTINCT
//     qualified wallets. Non-qualified wallet legs inside a qualifying
//     window do NOT add buyers and do NOT add USD.
//   · totalBuyUsd = Σ inputUsd over buy legs of QUALIFIED wallets only
//     (strict definition — dust from unqualified wallets is never mixed in).
//   · Merge rule: at most ONE signal per token. All qualifying windows of
//     a token are unioned: windowStart/windowEnd = bounding interval of
//     the counted qualified legs, firstBuyAt/lastBuyAt = min/max leg
//     timestamp, qualifiedBuyers = distinct union, totalBuyUsd = Σ over
//     legs belonging to any qualifying window. Overlapping windows merge
//     naturally; disjoint qualifying windows also collapse into one
//     signal (never emit duplicates per token — documented decision).
//   · Signals sorted: qualifiedBuyers.length desc, then totalBuyUsd desc.
//
// Integer/float safety: timestamps and USD are passed through as-is;
// no rounding, no fabrication. Sorting ties are stable.
// ─────────────────────────────────────────────────────────────

/** Structural minimal swap input — `NormalizedSwap` satisfies this. */
export interface ConfluenceSwap {
  walletAddress: string;
  timestamp: number | null;
  inputMint: string;
  outputMint: string;
  inputUsd: number | null;
  completeness: 'complete' | 'partial' | 'rejected';
}

export interface ConfluenceWallet {
  address: string;
  qualified: boolean;
}

export interface ConfluenceInput {
  swaps: readonly ConfluenceSwap[];
  /** Addresses that passed classification (caller builds the Set). */
  qualifiedWallets: ReadonlySet<string>;
  /** Max span (ms) of a confluence window. Default 15 * 60_000. */
  windowMs?: number;
  /** Distinct qualified buyers needed inside one window. Default 2. */
  minQualifiedBuyers?: number;
  /** Buy legs below this USD value are ignored (anti-dust). Default 500. */
  minBuyUsd?: number;
}

export interface ConfluenceSignal {
  tokenMint: string;
  windowStart: number;
  windowEnd: number;
  qualifiedBuyers: string[];
  /** Sum of buy-leg USD from qualified wallets only. */
  totalBuyUsd: number;
  firstBuyAt: number;
  lastBuyAt: number;
}

export interface ConfluenceResult {
  signals: ConfluenceSignal[];
  stats: {
    /** Total input swaps seen (before any filtering). */
    swapsSeen: number;
    /** Buy legs passing all count filters (SOL→token, complete, usd≥min, ts present). */
    buyLegsCounted: number;
    /** Distinct token mints among counted buy legs. */
    tokensScanned: number;
  };
}

export const CONFLUENCE_DEFAULTS = {
  windowMs: 15 * 60_000,
  minQualifiedBuyers: 2,
  minBuyUsd: 500,
} as const;

/** One qualifying leg kept for windowing. */
interface CountedLeg {
  ts: number;
  wallet: string;
  usd: number;
  qualified: boolean;
}

/**
 * Pure confluence detector. Zero I/O, zero DB, deterministic.
 */
export function detectConfluence(
  swaps: readonly ConfluenceSwap[],
  qualifiedWallets: ReadonlySet<string>,
  options: Omit<ConfluenceInput, 'swaps' | 'qualifiedWallets'> = {},
): ConfluenceResult {
  const windowMs = options.windowMs ?? CONFLUENCE_DEFAULTS.windowMs;
  const minQualifiedBuyers =
    options.minQualifiedBuyers ?? CONFLUENCE_DEFAULTS.minQualifiedBuyers;
  const minBuyUsd = options.minBuyUsd ?? CONFLUENCE_DEFAULTS.minBuyUsd;

  const SOL = 'So11111111111111111111111111111111111111112'; // == SOL_MINT (kept local: pure module, zero I/O imports)

  // 1. Filter to countable buy legs, grouped per token.
  const perToken = new Map<string, CountedLeg[]>();
  let buyLegsCounted = 0;

  for (const s of swaps) {
    if (s.outputMint === SOL) continue; // sell leg (or SOL→SOL) — never counts
    if (s.inputMint !== SOL) continue; // not a SOL-funded buy leg
    if (s.completeness !== 'complete') continue;
    if (s.inputUsd == null) continue; // never invent USD
    if (!(s.inputUsd >= minBuyUsd)) continue; // dust filter (also drops NaN)
    if (s.timestamp == null) continue; // unwindowable
    buyLegsCounted += 1;
    const token = s.outputMint;
    let legs = perToken.get(token);
    if (!legs) {
      legs = [];
      perToken.set(token, legs);
    }
    legs.push({
      ts: s.timestamp,
      wallet: s.walletAddress,
      usd: s.inputUsd,
      qualified: qualifiedWallets.has(s.walletAddress),
    });
  }

  // 2. Per token: sliding window (inclusive), union all qualifying windows.
  const signals: ConfluenceSignal[] = [];
  for (const [tokenMint, legs] of perToken) {
    legs.sort((a, b) => a.ts - b.ts);

    const counted = new Array<boolean>(legs.length).fill(false);
    let j = 0;
    for (let i = 0; i < legs.length; i++) {
      if (j < i) j = i;
      while (j + 1 < legs.length && legs[j + 1].ts - legs[i].ts <= windowMs) j++;
      // window = legs[i..j], inclusive span
      if (j - i + 1 < minQualifiedBuyers) continue;
      const buyers = new Set<string>();
      for (let k = i; k <= j; k++) {
        if (legs[k].qualified) buyers.add(legs[k].wallet);
      }
      if (buyers.size >= minQualifiedBuyers) {
        for (let k = i; k <= j; k++) counted[k] = true;
      }
    }

    // Union of counted legs → at most one signal per token.
    let minTs: number | null = null;
    let maxTs: number | null = null;
    let totalBuyUsd = 0;
    const buyers = new Set<string>();
    for (let k = 0; k < legs.length; k++) {
      if (!counted[k]) continue;
      const leg = legs[k];
      if (!leg.qualified) continue; // USD/buyers from qualified wallets only
      if (minTs == null || leg.ts < minTs) minTs = leg.ts;
      if (maxTs == null || leg.ts > maxTs) maxTs = leg.ts;
      totalBuyUsd += leg.usd;
      buyers.add(leg.wallet);
    }
    if (buyers.size < minQualifiedBuyers) continue; // no qualifying union

    signals.push({
      tokenMint,
      windowStart: minTs as number,
      windowEnd: maxTs as number,
      qualifiedBuyers: [...buyers],
      totalBuyUsd,
      firstBuyAt: minTs as number,
      lastBuyAt: maxTs as number,
    });
  }

  // 3. Sort: buyer count desc, then USD desc (stable for ties).
  signals.sort((a, b) => {
    if (b.qualifiedBuyers.length !== a.qualifiedBuyers.length) {
      return b.qualifiedBuyers.length - a.qualifiedBuyers.length;
    }
    return b.totalBuyUsd - a.totalBuyUsd;
  });

  return {
    signals,
    stats: {
      swapsSeen: swaps.length,
      buyLegsCounted,
      tokensScanned: perToken.size,
    },
  };
}
