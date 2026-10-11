// ─────────────────────────────────────────────────────────────
// FIFO episode builder — pure, zero I/O, paper/shadow mode.
// Consumes NormalizedSwap (solana-harvest.ts) and emits per-token
// episodes compatible with TradeEpisode (wallet-intel.ts).
//
// One episode = one chain × wallet × token aggregate over the window
// (first buy → last exit), matching the classifier contract.
//
// Rules (no silent invention):
// · FIFO lots per chain+wallet+token. Partial sells close only sold qty.
// · openFrac = remaining / totalBought. openFrac>0.1 episodes are emitted
//   but the classifier excludes them from PnL/WR (exposure only).
// · Fee (feeUsd) attributed EXACTLY ONCE per signature to the non-SOL
//   side: SOL→token buys add fee to buyCost; token→SOL sells subtract
//   fee from proceeds; token→token swaps attribute to the sell side.
// · Non-swaps (completeness rejected), dup keys, null timestamps, and
//   legs missing required USD are NEVER scored — counted with reasons.
// · SOL_MINT is quote-only: no SOL episodes are emitted.
// · Missing USD ≠ zero. Stale/current USD must already be flagged
//   upstream (stalePrice-current-only); legs without historical USD are
//   skipped with missing-usd reasons and blocked from metrics.
// ─────────────────────────────────────────────────────────────
import { SOL_MINT, type NormalizedSwap } from './solana-harvest';
import type { TradeEpisode } from './wallet-intel';

export interface BuiltEpisode extends TradeEpisode {
  chain: 'solana';
  walletAddress: string;
  tokenMint: string;
  entryTs: number | null;
  exitTs: number | null;
  entrySig: string | null;
  exitSig: string | null;
  closedQty: number;
  remainingQty: number;
  totalBoughtQty: number;
  buyCostUsd: number;
  sellProceedsUsd: number;
  feeUsdAttributed: number;
  realizedPnlUsd: number;
  sigs: string[];
  completeness: 'complete' | 'partial';
  limitations: string[];
}

export interface OpenPosition {
  chain: 'solana';
  walletAddress: string;
  tokenMint: string;
  remainingQty: number;
  remainingCostUsd: number;
  openFrac: number;
  sigs: string[];
}

export interface EpisodeBuildStats {
  swapsSeen: number;
  swapsUsed: number;
  dupSkipped: number;
  nonSwapSkipped: number;
  badTimestampSkipped: number;
  missingUsdBuySkipped: number;
  missingUsdSellSkipped: number;
  orphanSells: number;
  tokensTracked: number;
  episodesClosed: number;
  positionsOpen: number;
}

export interface EpisodeBuildResult {
  episodes: BuiltEpisode[];
  openPositions: OpenPosition[];
  stats: EpisodeBuildStats;
  limitations: string[];
}

interface Lot {
  qty: number;
  unitCost: number;
  ts: number;
  sig: string;
}

interface TokenState {
  walletAddress: string;
  tokenMint: string;
  lots: Lot[];
  totalBoughtQty: number;
  totalBuyCost: number;
  closedQty: number;
  closedBuyCost: number;
  closedProceeds: number;
  feeAttributed: number;
  feeKnown: boolean;
  entryTs: number | null;
  exitTs: number | null;
  entrySig: string | null;
  exitSig: string | null;
  sigs: Set<string>;
  limitations: Set<string>;
  hasCompleteLeg: boolean;
}

function dedupKey(s: NormalizedSwap): string {
  return `${s.transactionSignature}:${s.inputMint}>${s.outputMint}`;
}

export function buildEpisodes(swaps: NormalizedSwap[]): EpisodeBuildResult {
  const stats: EpisodeBuildStats = {
    swapsSeen: swaps.length,
    swapsUsed: 0,
    dupSkipped: 0,
    nonSwapSkipped: 0,
    badTimestampSkipped: 0,
    missingUsdBuySkipped: 0,
    missingUsdSellSkipped: 0,
    orphanSells: 0,
    tokensTracked: 0,
    episodesClosed: 0,
    positionsOpen: 0,
  };
  const limitations: string[] = [];
  const seen = new Set<string>();
  const states = new Map<string, TokenState>();

  const ordered = [...swaps].sort((a, b) => {
    const ta = a.timestamp ?? Number.POSITIVE_INFINITY;
    const tb = b.timestamp ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.transactionSignature < b.transactionSignature ? -1 : 1;
  });

  const stateOf = (wallet: string, mint: string): TokenState => {
    const k = `${wallet}|${mint}`;
    let st = states.get(k);
    if (!st) {
      st = {
        walletAddress: wallet,
        tokenMint: mint,
        lots: [], totalBoughtQty: 0, totalBuyCost: 0, closedQty: 0,
        closedBuyCost: 0, closedProceeds: 0, feeAttributed: 0, feeKnown: true,
        entryTs: null, exitTs: null, entrySig: null, exitSig: null,
        sigs: new Set(), limitations: new Set(), hasCompleteLeg: false,
      };
      states.set(k, st);
    }
    return st;
  };

  for (const s of ordered) {
    const key = dedupKey(s);
    if (seen.has(key)) {
      stats.dupSkipped++;
      continue;
    }
    seen.add(key);
    if (s.completeness === 'rejected') {
      stats.nonSwapSkipped++;
      continue;
    }
    if (s.timestamp === null || !Number.isFinite(s.timestamp) || s.timestamp <= 0) {
      stats.badTimestampSkipped++;
      continue;
    }
    const feeUsd = s.feeUsd ?? 0;
    if (!s.feeKnown) {
      // fee unknown → flagged downstream via feeKnown=false, never invented
    }

    const inMint = s.inputMint;
    const outMint = s.outputMint;
    const ts = s.timestamp as number;
    let used = false;

    // ── Sell side: spend inputMint ──
    if (inMint && inMint !== SOL_MINT) {
      const st = stateOf(s.walletAddress, inMint);
      if (s.outputUsd === null) {
        stats.missingUsdSellSkipped++;
        st.limitations.add('missing-usd-sell-leg');
      } else if (s.inputAmount > 0) {
        const unitProceeds = s.outputUsd / s.inputAmount;
        let remaining = s.inputAmount;
        let matchedCost = 0;
        let matchedQty = 0;
        while (remaining > 0 && st.lots.length > 0) {
          const lot = st.lots[0];
          const q = Math.min(remaining, lot.qty);
          matchedCost += q * lot.unitCost;
          matchedQty += q;
          lot.qty -= q;
          remaining -= q;
          if (lot.qty <= 0) st.lots.shift();
        }
        if (matchedQty > 0) {
          const proceeds = matchedQty * unitProceeds;
          st.closedQty += matchedQty;
          st.closedBuyCost += matchedCost;
          st.closedProceeds += proceeds;
          st.exitTs = ts;
          st.exitSig = s.transactionSignature;
          st.sigs.add(s.transactionSignature);
          st.hasCompleteLeg = true;
          // Fee attribution: token→token → sell side; token→SOL → sell side.
          const feeToSell = outMint === SOL_MINT || (outMint !== SOL_MINT && inMint !== SOL_MINT) ? feeUsd : 0;
          if (feeToSell > 0) {
            st.closedProceeds -= feeToSell;
            st.feeAttributed += feeToSell;
          }
          if (!s.feeKnown) st.feeKnown = false;
          for (const l of s.limitations) {
            if (l !== 'missing-usd') st.limitations.add(l);
          }
          used = true;
        } else {
          stats.orphanSells++;
          st.sigs.add(s.transactionSignature);
        }
      }
    }

    // ── Buy side: receive outputMint ──
    if (outMint && outMint !== SOL_MINT) {
      const st = stateOf(s.walletAddress, outMint);
      if (s.inputUsd === null) {
        stats.missingUsdBuySkipped++;
        st.limitations.add('missing-usd-buy-leg');
      } else if (s.outputAmount > 0) {
        const unitCost = s.inputUsd / s.outputAmount;
        st.lots.push({ qty: s.outputAmount, unitCost, ts, sig: s.transactionSignature });
        st.totalBoughtQty += s.outputAmount;
        st.totalBuyCost += s.inputUsd;
        if (st.entryTs === null) {
          st.entryTs = ts;
          st.entrySig = s.transactionSignature;
        }
        st.sigs.add(s.transactionSignature);
        st.hasCompleteLeg = true;
        // Fee attribution: SOL→token buys add fee to buyCost.
        // Token→token buys do NOT take fee (already on sell side).
        const feeToBuy = inMint === SOL_MINT ? feeUsd : 0;
        if (feeToBuy > 0) {
          st.totalBuyCost += feeToBuy;
          // pro-rate fee into the new lot's unit cost
          const lot = st.lots[st.lots.length - 1];
          lot.unitCost += feeToBuy / s.outputAmount;
          st.feeAttributed += feeToBuy;
        }
        if (!s.feeKnown) st.feeKnown = false;
        for (const l of s.limitations) {
          if (l !== 'missing-usd') st.limitations.add(l);
        }
        used = true;
      }
    }

    if (used) stats.swapsUsed++;
  }

  const episodes: BuiltEpisode[] = [];
  const openPositions: OpenPosition[] = [];
  for (const st of states.values()) {
    const mint = st.tokenMint;
    if (!st.hasCompleteLeg && st.closedQty === 0 && st.totalBoughtQty === 0) continue;
    const remainingQty = st.lots.reduce((a, l) => a + l.qty, 0);
    const remainingCostUsd = st.lots.reduce((a, l) => a + l.qty * l.unitCost, 0);
    const openFrac = st.totalBoughtQty > 0 ? remainingQty / st.totalBoughtQty : (st.closedQty > 0 ? 0 : 1);
    const realizedPnlUsd = st.closedProceeds - st.closedBuyCost;
    const completeness = st.limitations.size === 0 && st.feeKnown ? 'complete' : 'partial';
    const ep: BuiltEpisode = {
      chain: 'solana',
      walletAddress: st.walletAddress,
      tokenMint: mint,
      token: mint,
      entryTs: st.entryTs,
      exitTs: st.exitTs,
      entrySig: st.entrySig,
      exitSig: st.exitSig,
      closedQty: st.closedQty,
      remainingQty,
      totalBoughtQty: st.totalBoughtQty,
      buyCost: st.closedBuyCost,
      buyCostUsd: st.closedBuyCost,
      sellProceeds: st.closedProceeds,
      sellProceedsUsd: st.closedProceeds,
      feeUsdAttributed: st.feeAttributed,
      feeKnown: st.feeKnown,
      realizedPnlUsd,
      openFrac,
      sigs: [...st.sigs],
      completeness,
      limitations: [...st.limitations],
    };
    episodes.push(ep);
    if (remainingQty > 0) {
      openPositions.push({
        chain: 'solana', walletAddress: ep.walletAddress, tokenMint: mint,
        remainingQty, remainingCostUsd, openFrac, sigs: [...st.sigs],
      });
    }
  }

  episodes.sort((a, b) => a.tokenMint < b.tokenMint ? -1 : 1);
  stats.tokensTracked = episodes.length;
  stats.episodesClosed = episodes.filter((e) => e.closedQty > 0).length;
  stats.positionsOpen = openPositions.length;
  if (stats.missingUsdBuySkipped > 0 || stats.missingUsdSellSkipped > 0) {
    limitations.push(`missing-usd legs skipped (buy ${stats.missingUsdBuySkipped}, sell ${stats.missingUsdSellSkipped}) — never scored`);
  }
  if (stats.dupSkipped > 0) limitations.push(`${stats.dupSkipped} duplicate event(s) skipped — no double-count`);
  if (stats.orphanSells > 0) limitations.push(`${stats.orphanSells} orphan sell(s) without cost basis ignored`);
  if (stats.nonSwapSkipped > 0) limitations.push(`${stats.nonSwapSkipped} non-swap event(s) excluded`);

  return { episodes, openPositions, stats, limitations };
}

/** Convert built episodes to the classifier's TradeEpisode shape. */
export function toTradeEpisodes(built: BuiltEpisode[]): TradeEpisode[] {
  return built.map((e) => ({
    token: e.tokenMint,
    buyCost: e.buyCostUsd,
    sellProceeds: e.sellProceedsUsd,
    feeKnown: e.feeKnown,
    openFrac: e.openFrac,
  }));
}
