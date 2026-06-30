import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { generateApiKey, listApiKeys, revokeApiKey, TIER_CONFIG } from '@/lib/api-keys'

export const dynamic = 'force-dynamic'

// GET /api/v1/keys — List all API keys (admin)
export async function GET() {
  const allKeys = listApiKeys()
  return apiJson({ keys: allKeys, tiers: TIER_CONFIG })
}

// POST /api/v1/keys — Create new API key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; tier?: string }

    if (!body.name) {
      return apiJson(null, { error: 'Missing required field: name', status: 400 })
    }

    const tier = (body.tier ?? 'free') as 'free' | 'pro' | 'enterprise'
    if (!['free', 'pro', 'enterprise'].includes(tier)) {
      return apiJson(null, { error: 'Invalid tier: must be free, pro, or enterprise', status: 400 })
    }

    const apiKey = generateApiKey({ name: body.name, tier })

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

// DELETE /api/v1/keys — Revoke API key
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (!key) {
      return apiJson(null, { error: 'Missing required param: key', status: 400 })
    }

    const revoked = revokeApiKey(key)
    if (!revoked) {
      return apiJson(null, { error: 'Key not found', status: 404 })
    }

    return apiJson({ revoked: true, message: 'API key has been revoked.' })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 500 })
  }
}
