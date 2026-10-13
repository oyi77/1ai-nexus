import { SOL_MINT, type NormalizedSwap } from '@/lib/modules/derived/solana-harvest'
import type { KolscanTransaction } from './index'

/**
 * Convert a KOLScan transaction into a NormalizedSwap compatible with the
 * existing wallet-discovery / foldWalletBuys pipeline.
 *
 * KOLScan transactions are complete SOL-denominated spot purchases:
 *   - inputMint: SOL (So11111111111111111111111111111111111111112)
 *   - outputMint: outTokenAddress
 *   - inputUsd: usdValue (solChange * live SOL price)
 *   - completeness: 'complete'
 *   - source: 'kolscan'
 */
export function kolscanTxToNormalizedSwap(tx: KolscanTransaction): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: tx.walletAddress,
    transactionSignature: tx.signature,
    timestamp: tx.timestamp,
    inputMint: SOL_MINT,
    outputMint: tx.outTokenAddress,
    inputAmount: tx.solChange,
    outputAmount: tx.outAmount,
    inputUsd: tx.usdValue,
    outputUsd: null,
    feeNative: null,
    feeUsd: null,
    feeKnown: false,
    source: `kolscan:${tx.dex}`,
    completeness: tx.usdValue !== null && tx.usdValue > 0 ? 'complete' : 'partial',
    limitations: [],
  }
}
