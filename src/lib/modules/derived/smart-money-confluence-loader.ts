// ─────────────────────────────────────────────────────────────
// Fase 3 — Smart-money confluence loader (small I/O).
//
// Wires the pure detector to persisted state:
//   · loadQualifiedWallets() → Set<string> of Solana addresses whose
//     SmartMoneyWallet.status is QUALIFIED_SMART_MONEY | WHALE |
//     WHALE_AND_SMART_MONEY (the §5 qualified ladder; PROVISIONAL and
//     WATCHLIST are never qualified). Any error → empty Set + one warn
//     (never throws, never blocks detection with a broken gate).
//   · detectConfluence(swaps) → pure detectConfluence over live data.
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db';
import {
  detectConfluence,
  type ConfluenceResult,
  type ConfluenceSwap,
} from './smart-money-confluence';

export const QUALIFIED_STATUSES = [
  'QUALIFIED_SMART_MONEY',
  'WHALE',
  'WHALE_AND_SMART_MONEY',
] as const;

let warned = false;

/**
 * Qualified Solana addresses from the Fase 3 classification gate.
 * Failure → empty Set + a single warn (graceful, never throws).
 */
export async function loadQualifiedWallets(): Promise<Set<string>> {
  try {
    const rows = await prisma.smartMoneyWallet.findMany({
      where: {
        status: { in: [...QUALIFIED_STATUSES] },
        wallet: { is: { chain: 'solana' } },
      },
      select: { wallet: { select: { address: true } } },
    });
    const out = new Set<string>();
    for (const r of rows) {
      if (r.wallet?.address) out.add(r.wallet.address);
    }
    return out;
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        '[smart-money-confluence] loadQualifiedWallets failed; gating OFF (empty set).',
        err,
      );
    }
    return new Set<string>();
  }
}

/**
 * Detection with the persisted qualification gate.
 * `options` passes straight through to the pure detector.
 */
export async function detectConfluenceLive(
  swaps: readonly ConfluenceSwap[],
  options: {
    windowMs?: number;
    minQualifiedBuyers?: number;
    minBuyUsd?: number;
  } = {},
): Promise<ConfluenceResult> {
  const qualified = await loadQualifiedWallets();
  return detectConfluence(swaps, qualified, options);
}
