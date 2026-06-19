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

  // Fetch transaction history from Blockscout
  let txHistory: unknown[] = []
  try {
    const result = await registry.fetchOne('blockscout-eth', {
      action: 'txlist',
      address,
      chain,
      limit: '20',
    })
    txHistory = (result.data as unknown[]) ?? []
  } catch {
    // Silent — wallet may not have txs on this chain
  }

  // Fetch token transfers
  let tokenTransfers: unknown[] = []
  try {
    const result = await registry.fetchOne('blockscout-eth', {
      action: 'tokentx',
      address,
      chain,
      limit: '20',
    })
    tokenTransfers = (result.data as unknown[]) ?? []
  } catch {
    // Silent
  }

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
  })
}
