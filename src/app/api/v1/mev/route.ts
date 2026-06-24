// ─────────────────────────────────────────────────────────────
// GET /api/v1/mev — Real MEV detection via Ethereum RPC
// Detects sandwich attacks, frontrunning, arbitrage, JIT liquidity
// Uses mev-detector.ts — zero API keys, public RPC endpoints
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { detectMevCached } from '@/lib/modules/derived/mev-detector'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const blocks = Math.min(20, Math.max(1, Number(searchParams.get('blocks') ?? '5')))

    const result = await detectMevCached(blocks)

    const resp = NextResponse.json({
      data: {
        recentMEV: result.events.slice(0, 30).map(e => ({
          type: e.type,
          txHash: e.txHash,
          profit: e.profitUsd,
          profitEth: e.profitEth,
          block: e.blockNumber,
          strategy: e.description,
          victimTx: e.victimTxHash,
          gasUsed: e.gasUsed,
          gasPriceGwei: e.gasPriceGwei,
          confidence: e.confidence,
          severity: e.severity,
          botAddress: e.botAddress,
        })),
        stats: {
          totalMEV24h: result.summary.totalProfitUsd,
          totalProfitEth: result.summary.totalProfitEth,
          avgProfit: result.summary.totalEvents > 0 ? result.summary.totalProfitUsd / result.summary.totalEvents : 0,
          topStrategies: Object.entries(result.summary.byType)
            .filter(([, count]) => count > 0)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count),
          bySeverity: result.summary.bySeverity,
          blocksScanned: result.summary.blocksScanned,
          scanTimeMs: result.summary.scanTimeMs,
          ethPriceUsd: result.summary.ethPriceUsd,
        },
        topBots: result.summary.topBots,
        scannedRange: result.scannedRange,
      },
      error: null,
    })
    resp.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    return resp
  } catch (error) {
    console.error('MEV detection error:', error)
    return NextResponse.json({ data: null, error: 'Failed to detect MEV' }, { status: 502 })
  }
}