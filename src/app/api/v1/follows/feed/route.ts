import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

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

// GET /api/v1/follows/feed — recent transactions from followed wallets/entities
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request)
    if (!userId) return apiError('Authentication required', 401)

    const { searchParams } = request.nextUrl
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20') || 20))

    const follows = await prisma.follow.findMany({
      where: { userId },
      select: { targetType: true, targetId: true },
    })

    // Collect wallet ids: wallet follows use targetId directly,
    // entity follows resolve to their linked wallets via entityId.
    const walletTargetIds = follows.filter(f => f.targetType === 'wallet').map(f => f.targetId)
    const entityTargetIds = follows.filter(f => f.targetType === 'entity').map(f => f.targetId)

    let entityWalletIds: string[] = []
    if (entityTargetIds.length > 0) {
      const wallets = await prisma.wallet.findMany({
        where: { entityId: { in: entityTargetIds } },
        select: { id: true },
      })
      entityWalletIds = wallets.map(w => w.id)
    }

    const walletIds = [...walletTargetIds, ...entityWalletIds]
    if (walletIds.length === 0) {
      return apiJson({ items: [] })
    }

    const txs = await prisma.transaction.findMany({
      where: { walletId: { in: walletIds } },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        wallet: {
          select: {
            address: true,
            chain: true,
            entityId: true,
            entity: { select: { name: true, type: true } },
          },
        },
      },
    })

    const items = txs.map(tx => ({
      id: tx.id,
      wallet: tx.wallet
        ? {
            address: tx.wallet.address,
            chain: tx.wallet.chain,
            entityId: tx.wallet.entityId,
            entity: tx.wallet.entity,
          }
        : null,
      entity: null,
      type: tx.approval ? 'approval' : tx.isMEV ? 'mev' : 'transfer',
      amountUsd: tx.amountUsd,
      tokenSymbol: tx.tokenSymbol,
      timestamp: tx.timestamp.toISOString(),
      txHash: tx.txHash,
    }))

    return apiJson({ items })
  } catch (error) {
    console.error('GET /api/v1/follows/feed error:', error)
    return apiError('Internal server error', 500)
  }
}