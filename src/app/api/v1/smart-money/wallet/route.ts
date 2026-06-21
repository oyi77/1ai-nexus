// ─────────────────────────────────────────────────────────────
// GET /api/v1/smart-money/wallet?address=0x... — Wallet Profiler
// Returns entity label + basic on-chain data for a wallet
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'
import { getEntityLabel } from '@/lib/modules/ai-signals/entity-labels-seed'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')
  const chain = searchParams.get('chain') ?? 'eth'

  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }

  const registry = registerAllModules()
  const entityLabel = getEntityLabel(address, chain)

  // Parallel fetch tx history + token transfers
  const [txResult, tokenResult] = await Promise.allSettled([
    registry.fetchOne('blockscout-eth', {
      action: 'txlist',
      address,
      chain,
      limit: '20',
    }),
    registry.fetchOne('blockscout-eth', {
      action: 'tokentx',
      address,
      chain,
      limit: '20',
    }),
  ])

  const txHistory: unknown[] = txResult.status === 'fulfilled'
    ? ((txResult.value.data as unknown[]) ?? [])
    : []
  const tokenTransfers: unknown[] = tokenResult.status === 'fulfilled'
    ? ((tokenResult.value.data as unknown[]) ?? [])
    : []

  return NextResponse.json({
    address,
    chain,
    entity: entityLabel ? {
      label: entityLabel.label,
      category: entityLabel.category,
      confidence: entityLabel.confidence,
    } : null,
    txCount: txHistory.length,
    tokenTransferCount: tokenTransfers.length,
    recentTxs: txHistory.slice(0, 5),
    recentTokenTransfers: tokenTransfers.slice(0, 5),
  }, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  })
}
