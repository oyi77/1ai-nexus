// ─────────────────────────────────────────────────────────────
// Google-Sheet export for KOL/Axiom gate passers.
//
// Reuses the existing `appendWalletsToSheet` plumbing from smart-money-sync
// (gog OAuth token → Sheets REST append). Two groups are appended
// separately — Axiom wallets first, then KOLScan screened buys — so each
// source keeps a recognizable name prefix in the operator's wallet sheet.
//
// Never-fail invariant: missing creds or a rejected append degrades to a
// logged count of 0; no function here throws.
// ─────────────────────────────────────────────────────────────

import { appendWalletsToSheet, type SheetWallet } from '@/lib/modules/derived/smart-money-sync'
import type { AxiomWallet } from './axiom-monitor'
import type { KolscanTransaction } from './kolscan'

function fmtWinRate(v: number | null): string {
  return v !== null ? `${Math.round(v * 100)}%` : 'n/a'
}

function fmtSignedPct(v: number | null): string {
  if (v === null) return 'n/a'
  const rounded = Math.round(v * 100)
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

/** Convert a gate-passing Axiom wallet to a sheet row (Address, Name). */
export function axiomWalletToSheetRow(w: AxiomWallet): { address: string; name: string } {
  return {
    address: w.address,
    name: `AXIOM wr=${fmtWinRate(w.winRate30d)} pnl=${fmtSignedPct(w.pnl30d)}`,
  }
}

/** Convert a screened KOLScan buy to a sheet row (Address, Name). */
export function kolscanTxToSheetRow(tx: KolscanTransaction): { address: string; name: string } {
  const token = tx.outTokenSymbol || tx.outTokenAddress.slice(0, 8)
  const usd = tx.usdValue !== null ? `$${Math.round(tx.usdValue)}` : 'n/a'
  return {
    address: tx.walletAddress,
    name: `KOLSCAN ${tx.kolName} ${token} ${usd}`,
  }
}

/**
 * Append gate passers to the operator's wallet-source sheet. Two calls:
 * Axiom group, then KOLScan group. Returns the number appended per group.
 * If `appendWalletsToSheet` reports 0 for non-empty input, that group is
 * counted as 0 gracefully (creds missing / append rejected).
 */
export async function exportGatePassersToSheet(opts: {
  axiom?: AxiomWallet[]
  kolscan?: KolscanTransaction[]
} = {}): Promise<{ axiomAdded: number; kolscanAdded: number }> {
  const axiomWallets: SheetWallet[] = (opts.axiom ?? []).map(axiomWalletToSheetRow)
  const kolscanWallets: SheetWallet[] = (opts.kolscan ?? []).map(kolscanTxToSheetRow)

  let axiomAdded = 0
  let kolscanAdded = 0
  try {
    axiomAdded = await appendWalletsToSheet(axiomWallets)
  } catch (err) {
    console.error(`[sheet-export] axiom append failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    kolscanAdded = await appendWalletsToSheet(kolscanWallets)
  } catch (err) {
    console.error(`[sheet-export] kolscan append failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { axiomAdded, kolscanAdded }
}
