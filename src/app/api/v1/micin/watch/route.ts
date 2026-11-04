import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface WatchBody {
  userId?: unknown
  walletAddress?: unknown
  mint?: unknown
  entryPrice?: unknown
  targetPrice?: unknown
  stopLoss?: unknown
  marketCapUsd?: unknown
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

export async function POST(request: NextRequest) {
  let body: WatchBody
  try {
    body = (await request.json()) as WatchBody
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const userId = isString(body.userId) ? body.userId.trim() : 'default'
  const walletAddress = isString(body.walletAddress) ? body.walletAddress.trim() : null
  const mint = isString(body.mint) ? body.mint.trim() : null
  const entryPrice = isNumber(body.entryPrice) ? body.entryPrice : null
  const targetPrice = isNumber(body.targetPrice) ? body.targetPrice : null
  const stopLoss = isNumber(body.stopLoss) ? body.stopLoss : null
  const marketCapUsd = isNumber(body.marketCapUsd) ? body.marketCapUsd : null

  if (!walletAddress || !mint || !entryPrice) {
    return apiError('Missing walletAddress, mint, or entryPrice', 400)
  }

  // Guard: reject unknown/oversized market cap (unknown MC = no safety gate downstream).
  // Ceiling is operator-configurable; default $10M matches the accumulation-alert exclusion.
  const maxMarketCapUsd = Number(process.env.MICIN_MAX_MARKET_CAP_USD ?? 10_000_000)
  if (!marketCapUsd) {
    return apiError('marketCapUsd required: unknown market cap cannot be risk-gated', 400)
  }
  if (marketCapUsd > maxMarketCapUsd) {
    return apiError(
      `marketCapUsd ${marketCapUsd} exceeds watch ceiling ${maxMarketCapUsd}`,
      422,
    )
  }

  try {
    const position = await prisma.memePosition.create({
      data: {
        userId,
        walletAddress,
        mint,
        entryPrice,
        targetPrice,
        stopLoss,
        status: 'OPEN',
      },
    })
    return apiSuccess({ position })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return apiError(message, 500)
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId') ?? 'default'
  const positions = await prisma.memePosition.findMany({
    where: { userId, status: { not: 'CLOSED' } },
    orderBy: { createdAt: 'desc' },
  })
  return apiSuccess({ positions })
}
