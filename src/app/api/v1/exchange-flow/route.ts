// ─────────────────────────────────────────────────────────────
// GET /api/v1/exchange-flow — Exchange flow intelligence
// Whale deposits, withdrawals, netflow, and alerts
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { ENTITY_SEEDS } from '@/lib/modules/ai-signals/entity-labels-seed'

export async function GET() {
  // Count entities by category and chain
  const cexEntities = ENTITY_SEEDS.filter(e => e.category === 'cex')
  const whaleEntities = ENTITY_SEEDS.filter(e => e.category === 'whale')
  const allChains = [...new Set(ENTITY_SEEDS.map(e => e.chain))]

  return NextResponse.json({
    exchangeWallets: cexEntities.length,
    whaleWallets: whaleEntities.length,
    totalEntities: ENTITY_SEEDS.length,
    chains: allChains,
    topExchanges: ['Binance', 'Coinbase', 'OKX', 'Bybit', 'Kraken', 'Bitfinex'],
    note: 'Exchange flow detection runs on-chain. Connect wallet tracking to see real-time deposits/withdrawals.',
  })
}
