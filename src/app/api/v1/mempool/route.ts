// ─────────────────────────────────────────────────────────────
// GET /api/v1/mempool — Mempool Radar
// Pending whale transactions, mempool stats, fee levels
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { registerAllModules } from '@/lib/modules'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'stats'
  const registry = registerAllModules()
  try {
    switch (action) {
      case 'stats': {
        const [fees, mempool] = await Promise.all([
          registry.fetchOne('mempool-space', { action: 'fees' }),
          registry.fetchOne('mempool-space', { action: 'mempool' }),
        ])

        const mempoolData = mempool.data as Record<string, unknown>
        const feeData = fees.data as Record<string, unknown>
        const txCount = (mempoolData?.count as number) ?? 0
        const totalFee = (mempoolData?.total_fee as number) ?? 0

        // Determine congestion level based on mempool size
        let congestion: { level: string; color: string; description: string }
        if (txCount < 5000) {
          congestion = { level: 'low', color: 'green', description: 'Mempool is clear' }
        } else if (txCount < 20000) {
          congestion = { level: 'medium', color: 'yellow', description: 'Moderate congestion' }
        } else if (txCount < 50000) {
          congestion = { level: 'high', color: 'orange', description: 'High congestion' }
        } else {
          congestion = { level: 'extreme', color: 'red', description: 'Extreme congestion' }
        }

        const response = NextResponse.json({
          data: {
            count: txCount,
            totalFee,
            fees: feeData,
            congestion,
            avgFee: txCount > 0 ? Math.round(totalFee / txCount) : 0,
            vsize: (mempoolData?.vsize as number) ?? 0,
          },
          error: null,
        }, {
          headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' },
        })
        return response
      }

      case 'whale': {
        // Mempool.space doesn't have a direct whale endpoint
        // Return empty array with info message
        return NextResponse.json({
          data: {
            transactions: [],
            count: 0,
            threshold: '10 BTC (~$100K)',
            note: 'Whale detection requires specialized mempool indexing',
          },
          error: null,
        }, {
          headers: { 'Cache-Control': 'public, max-age=60' },
        })
      }

      case 'all': {
        // Mempool.space doesn't expose full tx list via public API
        return NextResponse.json({
          data: {
            transactions: [],
            count: 0,
            note: 'Full mempool transaction list requires specialized API access',
          },
          error: null,
        }, {
          headers: { 'Cache-Control': 'public, max-age=60' },
        })
      }

      case 'blocks': {
        const blocks = await registry.fetchOne('mempool-space', { action: 'blocks' })
        const response = NextResponse.json({
          data: blocks.data,
          error: null,
        }, {
          headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
        })
        return response
      }

      case 'hashrate': {
        const hashrate = await registry.fetchOne('mempool-space', { action: 'hashrate' })
        const response = NextResponse.json({
          data: hashrate.data,
          error: null,
        }, {
          headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
        })
        return response
      }

      default:
        return apiError(`Unknown action: ${action}. Use: stats, whale, all, blocks, hashrate`, 400)
    }
  } catch (err) {
    console.error('[mempool] Error:', err)
    return apiError((err as Error).message, 502)
  }
}
