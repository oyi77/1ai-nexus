// ─────────────────────────────────────────────────────────────
// Fase 3 — Smart-money confluence producer (wallet activity → legs).
//
// Feeds the PURE detector (`smart-money-confluence.ts`) with real swap
// legs: for every qualified (BULLISH status) wallet in the SmartMoneyWallet
// DB, fetch its recent activity via `fetchWalletActivity` (GMGN keyless
// first, proven 10/10 complete) and keep only COUNTED-eligible buy legs:
//
//   · buy leg = SOL → token (inputMint === SOL_MINT, outputMint different)
//   · completeness === 'complete'
//   · inputUsd != null (null-USD rows are skipped — never invent USD)
//
// Discipline (mirrors the rest of the pipeline):
//   · qualification query mirrors `loadQualifiedWallets` (loader) and the
//     `BULLISH_STATUSES` set (smart-money-provider) — capped at walletLimit
//     so one cron pass never fans out over the whole classified universe
//   · per-wallet failure is tolerated and reported in `errors` — one dead
//     wallet must not zero the whole pass
//   · politeness: >=200ms between wallet fetches (upstream rate limits)
//   · never fabricates: legs keep their real timestamps / mints / USD
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db';
import { SOL_MINT, type NormalizedSwap } from '@/lib/modules/derived/solana-harvest';
import { fetchWalletActivity } from '@/lib/modules/derived/wallet-activity';
import { BULLISH_STATUSES } from '@/lib/modules/derived/smart-money-provider';
import type { ConfluenceSwap } from '@/lib/modules/derived/smart-money-confluence';

const DEFAULT_WALLET_LIMIT = 50;
const DEFAULT_SWAP_LIMIT = 25;
/** Politeness gap between consecutive wallet fetches (ms). */
const WALLET_FETCH_GAP_MS = 200;

export interface CollectConfluenceInputOpts {
  walletLimit?: number;
  swapLimit?: number;
}

export interface CollectedConfluenceInput {
  swaps: ConfluenceSwap[];
  qualified: Set<string>;
  /** One short string per failed wallet fetch (honest accounting). */
  errors: string[];
}

function walletLimit(): number {
  const parsed = Number.parseInt(process.env.CONFLUENCE_WALLET_LIMIT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WALLET_LIMIT;
}

/**
 * Pure mapping: one NormalizedSwap → one counted-eligible ConfluenceSwap.
 * Returns null for anything the detector would not count from a qualified
 * wallet: sell legs, leg-less rows (empty mints), rejected rows, and
 * null-USD rows (USD must never be invented downstream).
 */
export function swapToConfluenceSwap(s: NormalizedSwap): ConfluenceSwap | null {
  if (s.completeness === 'rejected') return null;
  if (!s.inputMint || !s.outputMint) return null; // leg-less row
  if (s.inputMint !== SOL_MINT || s.outputMint === SOL_MINT) return null; // sell / non-SOL leg
  if (s.completeness !== 'complete') return null;
  if (s.inputUsd === null) return null;
  return {
    walletAddress: s.walletAddress,
    timestamp: s.timestamp,
    inputMint: s.inputMint,
    outputMint: s.outputMint,
    inputUsd: s.inputUsd,
    completeness: s.completeness,
  };
}

export async function collectConfluenceInput(
  opts: CollectConfluenceInputOpts = {},
): Promise<CollectedConfluenceInput> {
  const limit = opts.walletLimit ?? walletLimit();
  const swapLimit = opts.swapLimit ?? DEFAULT_SWAP_LIMIT;
  const errors: string[] = [];

  // Same qualification gate as the loader / provider: BULLISH statuses only,
  // Solana wallets only, capped for one cron pass.
  let addresses: string[] = [];
  try {
    const rows = await prisma.smartMoneyWallet.findMany({
      where: {
        status: { in: [...BULLISH_STATUSES] },
        wallet: { is: { chain: 'solana' } },
      },
      select: { wallet: { select: { address: true } } },
      take: limit,
    });
    addresses = rows.map((r) => r.wallet?.address).filter((a): a is string => Boolean(a));
  } catch (err) {
    errors.push(`wallet-query: ${err instanceof Error ? err.message : String(err)}`);
    return { swaps: [], qualified: new Set<string>(), errors };
  }

  const qualified = new Set<string>(addresses);
  const swaps: ConfluenceSwap[] = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    // Politeness: >=200ms between wallet fetches (upstream rate limits).
    if (i > 0) await new Promise<void>((r) => setTimeout(r, WALLET_FETCH_GAP_MS));
    try {
      const activity = await fetchWalletActivity(address, { limit: swapLimit });
      for (const s of activity.swaps) {
        const leg = swapToConfluenceSwap(s);
        if (leg) swaps.push(leg);
      }
    } catch (err) {
      errors.push(`${address}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { swaps, qualified, errors };
}
