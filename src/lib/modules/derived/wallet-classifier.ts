// ─────────────────────────────────────────────────────────────
// Persist the classifier verdict onto SmartMoneyWallet.
//
// This is the only writer that touches the new classification columns.
// It is deliberately kept separate from classifyWallet (pure) so the
// classification logic stays zero-I/O and unit-testable.
//
// IMPORTANT: it does NOT invent PnL/win-rate. The caller supplies episodes
// and whale evidence (Phase 3 harvest builds these from on-chain swap
// history; wallet-pnl.ts remains the realized-PnL engine). With no
// episodes the row is marked UNKNOWN — never PASS by omission.
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db'
import {
  classifyWallet,
  type ClassifyInput,
  type SmartMoneyConfig,
} from './wallet-intel'

export async function persistWalletClassification(
  walletId: string,
  input: ClassifyInput,
  config?: SmartMoneyConfig,
): Promise<string> {
  const out = classifyWallet(input, config)
  const metrics = {
    status: out.status,
    pnl30d: out.pnl30d,
    winRate: out.winRate,
    sampleCount: out.episodesUsed,
    profitableTokens: out.profitableTokens,
    confidence: out.confidence,
    reasons: out.reasons as unknown as object,
    limitations: out.limitations as unknown as object,
    classifiedAt: new Date(),
  }
  await prisma.smartMoneyWallet.upsert({
    where: { walletId },
    create: {
      walletId,
      category: 'trader',
      score: 0,
      ...metrics,
    },
    update: metrics,
  })
  return out.status
}
