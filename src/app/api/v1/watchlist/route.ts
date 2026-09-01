import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

const MARKETS = new Set(['IDX', 'CRYPTO'])

async function requireUser(request: NextRequest): Promise<string | null> {
  let token: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = request.cookies.get('nexus-session')?.value
  }
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload?.userId) return null
  return payload.userId
}

// GET /api/v1/watchlist — list current user's watchlist symbols
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request)
    if (!userId) return apiError('Authentication required', 401)

    const rows = await prisma.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    return apiJson({
      watchlist: rows.map((r) => ({ symbol: r.symbol, market: r.market })),
    })
  } catch (error) {
    console.error('GET /api/v1/watchlist error:', error)
    return apiError('Internal server error', 500)
  }
}

// POST /api/v1/watchlist — add a symbol to the user's watchlist
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request)
    if (!userId) return apiError('Authentication required', 401)

    const body = (await request.json()) as { symbol?: unknown; market?: unknown }
    const rawSymbol = body.symbol
    const rawMarket = body.market

    if (typeof rawSymbol !== 'string' || rawSymbol.trim() === '') {
      return apiError('Missing required field: symbol', 400)
    }
    if (typeof rawMarket !== 'string' || !MARKETS.has(rawMarket.trim().toUpperCase())) {
      return apiError('Invalid market: must be "IDX" or "CRYPTO"', 400)
    }

    const symbol = rawSymbol.trim().toUpperCase()
    const market = rawMarket.trim().toUpperCase()

    await prisma.watchlist.upsert({
      where: { userId_symbol_market: { userId, symbol, market } },
      create: { userId, symbol, market },
      update: {}, // no-op on conflict — already watching
    })

    return apiJson({ added: { symbol, market } })
  } catch (error) {
    console.error('POST /api/v1/watchlist error:', error)
    return apiError('Internal server error', 500)
  }
}

// DELETE /api/v1/watchlist — remove a symbol from the user's watchlist
export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireUser(request)
    if (!userId) return apiError('Authentication required', 401)

    const { searchParams } = request.nextUrl
    const symbol = searchParams.get('symbol')?.trim().toUpperCase()
    const market = searchParams.get('market')?.trim().toUpperCase()

    if (!symbol || symbol === '') {
      return apiError('Missing required param: symbol', 400)
    }
    if (!market || !MARKETS.has(market)) {
      return apiError('Invalid market: must be "IDX" or "CRYPTO"', 400)
    }

    const { count } = await prisma.watchlist.deleteMany({
      where: { userId, symbol, market },
    })

    return apiJson({ removed: count > 0 })
  } catch (error) {
    console.error('DELETE /api/v1/watchlist error:', error)
    return apiError('Internal server error', 500)
  }
}
