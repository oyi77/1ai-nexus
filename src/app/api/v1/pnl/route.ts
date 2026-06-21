// ─────────────────────────────────────────────────────────────
// GET /api/v1/pnl — Wallet PnL tracking and leaderboard
// ─────────────────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server'
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
      return NextResponse.json({
        wallets,
        count: wallets.length,
        generated: new Date().toISOString(),
      }, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
      })
    }

    // Single wallet PnL
    if (!address) {
      return NextResponse.json(
        { error: 'address query parameter required (or use ?leaderboard=true)' },
        { status: 400 },
      )
    }

    const pnl = await calculateWalletPnl(address, chain)
    return NextResponse.json({
      data: pnl,
      generated: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    })
  } catch (error) {
    console.error('GET /api/v1/pnl error:', error)
    return NextResponse.json(
      { error: 'Failed to calculate PnL', details: String(error) },
      { status: 500 },
    )
  }
}
