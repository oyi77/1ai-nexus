// ─────────────────────────────────────────────────────────────
// Smart Money Flow Tracker — Real-time whale/entity monitoring
// Tracks large transactions across chains and alerts on activity
// Uses on-chain indexers + entity DB + GeckoTerminal
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'

interface SmartMoneyEvent {
  entityName: string
  entityType: string
  walletAddress: string
  chain: string
  action: 'buy' | 'sell' | 'transfer' | 'bridge' | 'deposit' | 'withdraw'
  token: string
  amount: number
  usdValue: number
  timestamp: string
  txHash: string
  signal: string
}

async function fetchSmartMoneyFlows(): Promise<{ events: SmartMoneyEvent[]; summary: Record<string, number> }> {
  // Get recent transactions with entity context
  const txs = await prisma.transaction.findMany({
    where: {
      amountUsd: { gt: 10000 }, // Only large txs
    },
    include: {
      wallet: {
        include: {
          entity: {
            select: { name: true, type: true, totalUsdValue: true, verified: true }
          }
        }
      }
    },
    orderBy: { timestamp: 'desc' },
    take: 100,
  })

  const events: SmartMoneyEvent[] = txs.map(tx => {
    const entityName = tx.wallet?.entity?.name ?? 'Unknown'
    const entityType = tx.wallet?.entity?.type ?? 'unknown'
    
    // Detect action from tx data
    let action: 'buy' | 'sell' | 'transfer' | 'bridge' | 'deposit' | 'withdraw' = 'transfer'
    if (tx.to?.toLowerCase() === tx.from?.toLowerCase()) action = 'deposit'
    else if (tx.from && tx.to) action = 'transfer'
    
    // Signal based on entity type and action
    let signal = 'Monitor'
    if (entityType === 'exchange' && action === 'deposit') signal = 'Bearish — Deposit to exchange'
    else if (entityType === 'exchange' && action === 'transfer') signal = 'Bullish — Transfer from exchange'
    else if (entityType === 'fund' && tx.amountUsd > 100000) signal = 'Whale Fund Movement'
    
    return {
      entityName,
      entityType,
      walletAddress: tx.wallet?.address ?? tx.from ?? '',
      chain: tx.chain,
      action,
      token: tx.tokenSymbol ?? 'ETH',
      amount: parseFloat(tx.amountRaw ?? '0'),
      usdValue: tx.amountUsd ?? 0,
      timestamp: tx.timestamp?.toISOString() ?? new Date().toISOString(),
      txHash: tx.txHash,
      signal,
    }
  })

  // Summary by entity type
  const summary: Record<string, number> = {}
  for (const e of events) {
    summary[e.entityType] = (summary[e.entityType] || 0) + e.usdValue
  }

  return { events: events.slice(0, 50), summary }
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('smart-money-flows', 30_000, fetchSmartMoneyFlows)
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Smart money flows error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch smart money flows' }, { status: 502 })
  }
}
