// ─────────────────────────────────────────────────────────────
// GET /api/v1/pnl — Wallet PnL tracking and leaderboard
// ─────────────────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import {
  calculateWalletPnl,
  getTopWallets,
  updateLeaderboard,
} from '@/lib/modules/derived/wallet-pnl'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const address = searchParams.get('address')
    const chain = searchParams.get('chain') ?? 'eth'
    const isLeaderboard = searchParams.get('leaderboard') === 'true'
    const limit = parseInt(searchParams.get('limit') ?? '50', 10)

    // Leaderboard mode
    if (isLeaderboard) {
      await updateLeaderboard()
      const wallets = getTopWallets(limit)
      const response = NextResponse.json({
        data: { wallets, count: wallets.length, generated: new Date().toISOString() },
        error: null,
      }, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
      })
      return response
    }

    // Single wallet PnL
    if (!address) {
      return apiError('address query parameter required (or use ?leaderboard=true)', 400)
    }

    const pnl = await calculateWalletPnl(address, chain)
    const response = NextResponse.json({
      data: { pnl, generated: new Date().toISOString() },
      error: null,
    }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    })
    return response
  } catch (error) {
    console.error('GET /api/v1/pnl error:', error)
    return apiError('Failed to calculate PnL', 500)
  }
}
