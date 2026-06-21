// ─────────────────────────────────────────────────────────────
// GET /api/v1/mempool — Mempool Radar
// Pending whale transactions, mempool stats, fee levels
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  getMempoolStats,
  getRecentMempoolTxs,
  getWhalePendingTxs,
  getFeeLevels,
  getCongestionLevel,
} from '@/lib/modules/onchain/mempool-radar'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'stats'

  try {
    switch (action) {
      case 'stats': {
        const [stats, fees] = await Promise.all([
          getMempoolStats(),
          getFeeLevels(),
        ])
        const congestion = getCongestionLevel(stats.count)
        return NextResponse.json({
          ...stats,
          fees,
          congestion,
          avgFee: stats.count > 0 ? Math.round(stats.totalFee / stats.count) : 0,
        }, {
          headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' },
        })
      }

      case 'whale': {
        const whales = await getWhalePendingTxs()
        return NextResponse.json({
          data: whales,
          count: whales.length,
          threshold: '10 BTC (~$100K)',
        }, {
          headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' },
        })
      }

      case 'all': {
        const txs = await getRecentMempoolTxs()
        return NextResponse.json({
          data: txs,
          count: txs.length,
        }, {
          headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' },
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use: stats, whale, all` },
          { status: 400 },
        )
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, data: [] },
      { status: 502 },
    )
  }
}
