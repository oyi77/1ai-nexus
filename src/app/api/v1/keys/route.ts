import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { generateApiKey, listUserKeys, revokeApiKey, TIER_CONFIG } from '@/lib/api-keys'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Extract user from JWT (Authorization header or nexus-session cookie). */
async function getUser(request: NextRequest): Promise<{ userId: string } | null> {
  let token: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = request.cookies.get('nexus-session')?.value
  }
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !payload.userId) return null
  return { userId: payload.userId }
}

// GET /api/v1/keys — List current user's API keys
export async function GET(request: NextRequest) {
  const user = await getUser(request)
  if (!user) return apiJson(null, { error: 'Authentication required', status: 401 })

  const keys = await listUserKeys(user.userId)
  return apiJson({ keys, tiers: TIER_CONFIG })
}

// POST /api/v1/keys — Create a new API key for the current user
export async function POST(request: NextRequest) {
  const user = await getUser(request)
  if (!user) return apiJson(null, { error: 'Authentication required', status: 401 })

  try {
    const body = await request.json() as { name?: string; tier?: string }

    if (!body.name) {
      return apiJson(null, { error: 'Missing required field: name', status: 400 })
    }

    // Security: NEVER trust the client-requested tier. Derive it server-side
    // from the user's actual plan in DB so a free user cannot mint an
    // 'enterprise' key (rateLimit 10000 / all features) by POSTing tier.
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { plan: true },
    })
    const plan = dbUser?.plan ?? 'free'
    const tier = (['free', 'pro', 'enterprise'] as const).includes(plan)
      ? plan
      : 'free'

    // A paid user picks their key tier; a free user is always 'free'.
    const keyTier = tier !== 'free' && body.tier === 'enterprise' ? 'enterprise' : tier
    const apiKey = await generateApiKey({ name: body.name, tier: keyTier, userId: user.userId })

    return apiJson({
      key: apiKey.key,
      id: apiKey.id,
      name: apiKey.name,
      tier: apiKey.tier,
      rateLimit: apiKey.rateLimit,
      features: TIER_CONFIG[tier].features,
      message: 'Save this key securely — it will not be shown again.',
    })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 500 })
  }
}

// DELETE /api/v1/keys — Revoke an API key (scoped to current user)
export async function DELETE(request: NextRequest) {
  const user = await getUser(request)
  if (!user) return apiJson(null, { error: 'Authentication required', status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (!key) {
      return apiJson(null, { error: 'Missing required param: key', status: 400 })
    }

    // Scope to the current user — a key owned by another user is "not found"
    // here, so we never revoke keys we don't own.
    const result = await revokeApiKey(key, user.userId)
    if (result === 'not_found') {
      return apiJson(null, { error: 'Key not found', status: 404 })
    }
    if (result === 'persist_failed') {
      return apiJson(null, { error: 'Failed to persist revocation — key is still active', status: 500 })
    }

    return apiJson({ revoked: true, message: 'API key has been revoked.' })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 500 })
  }
}