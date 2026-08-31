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

/** Resolve a wallet address or id to the internal wallet.id. Returns null if not found. */
async function resolveWalletId(id: string): Promise<string | null> {
  const wallet = await prisma.wallet.findFirst({
    where: { OR: [{ id }, { address: id }] },
    select: { id: true },
  })
  return wallet?.id ?? null
}

/** Resolve an entity id to the entity. Returns null if not found. */
async function resolveEntityId(id: string): Promise<string | null> {
  const entity = await prisma.entity.findUnique({
    where: { id },
    select: { id: true },
  })
  return entity?.id ?? null
}

// GET /api/v1/follows — list current user's follows
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request)
    if (!userId) return apiError('Authentication required', 401)

    const follows = await prisma.follow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    // Resolve labels: entity name for entity targets, wallet address for wallet targets
    const entityIds = follows.filter(f => f.targetType === 'entity').map(f => f.targetId)
    const walletIds = follows.filter(f => f.targetType === 'wallet').map(f => f.targetId)

    const [entities, wallets] = await Promise.all([
      entityIds.length > 0
        ? prisma.entity.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      walletIds.length > 0
        ? prisma.wallet.findMany({ where: { id: { in: walletIds } }, select: { id: true, address: true } })
        : Promise.resolve([]),
    ])

    const entityMap = new Map(entities.map(e => [e.id, e.name]))
    const walletMap = new Map(wallets.map(w => [w.id, w.address]))

    const items = follows.map(f => ({
      type: f.targetType,
      id: f.targetType === 'wallet' ? (walletMap.get(f.targetId) ?? f.targetId) : f.targetId,
      label: f.targetType === 'entity'
        ? (entityMap.get(f.targetId) ?? f.targetId)
        : (walletMap.get(f.targetId) ?? f.targetId),
      createdAt: f.createdAt.toISOString(),
    }))

    return apiJson({ follows: items })
  } catch (error) {
    console.error('GET /api/v1/follows error:', error)
    return apiError('Internal server error', 500)
  }
}

// POST /api/v1/follows — follow a wallet or entity
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request)
    if (!userId) return apiError('Authentication required', 401)

    const body = await request.json()
    const { type, id } = body as { type?: string; id?: string }

    if (!type || !['entity', 'wallet'].includes(type)) {
      return apiError('Invalid type: must be "entity" or "wallet"', 400)
    }
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return apiError('Missing required field: id', 400)
    }

    // Resolve to internal database id
    let targetId: string | null
    if (type === 'wallet') {
      targetId = await resolveWalletId(id.trim())
    } else {
      targetId = await resolveEntityId(id.trim())
    }

    if (!targetId) {
      return apiError(`${type} not found`, 404)
    }

    await prisma.follow.upsert({
      where: { userId_targetType_targetId: { userId, targetType: type, targetId } },
      create: { userId, targetType: type, targetId },
      update: {}, // no-op on conflict — already following
    })

    return apiJson({ following: true })
  } catch (error) {
    console.error('POST /api/v1/follows error:', error)
    return apiError('Internal server error', 500)
  }
}

// DELETE /api/v1/follows — unfollow a wallet or entity
export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireUser(request)
    if (!userId) return apiError('Authentication required', 401)

    const { searchParams } = request.nextUrl
    const type = searchParams.get('type')
    const id = searchParams.get('id')

    if (!type || !['entity', 'wallet'].includes(type)) {
      return apiError('Invalid type: must be "entity" or "wallet"', 400)
    }
    if (!id) {
      return apiError('Missing required param: id', 400)
    }

    // Resolve to internal database id
    let targetId: string | null
    if (type === 'wallet') {
      targetId = await resolveWalletId(id)
    } else {
      targetId = await resolveEntityId(id)
    }

    if (!targetId) {
      // Nothing to unfollow — already not following
      return apiJson({ following: false })
    }

    await prisma.follow.deleteMany({
      where: { userId, targetType: type, targetId },
    })

    return apiJson({ following: false })
  } catch (error) {
    console.error('DELETE /api/v1/follows error:', error)
    return apiError('Internal server error', 500)
  }
}