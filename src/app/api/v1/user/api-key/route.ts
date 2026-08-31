// ─────────────────────────────────────────────────────────────
// GET /api/v1/user/api-key?service=anthropic
// Check if user has an API key configured for a service
// POST /api/v1/user/api-key — Save/update API key
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { z } from 'zod/v4'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'
import { createHash } from 'crypto'

const ApiKeyRequest = z.object({ service: z.string().min(1), apiKey: z.string().min(1) })

async function authenticate(request: NextRequest) {
  let token: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = request.cookies.get('nexus-session')?.value
  }
  if (!token) return null
  const payload = await verifyToken(token)
  return payload?.userId ?? null
}

export async function GET(request: NextRequest) {
  const userId = await authenticate(request)
  if (!userId) return apiError('Authentication required', 401)

  const { searchParams } = new URL(request.url)
  const service = searchParams.get('service') ?? 'anthropic'

  try {
    const row = await prisma.userApiKey.findFirst({
      where: { userId, service },
      select: { isActive: true },
    })

    return apiJson({ service, hasKey: !!row && row.isActive })
  } catch (err) {
    console.error('api-key fetch error:', err)
    return apiError('Failed to check API key', 500)
  }
}

export async function POST(request: NextRequest) {
  const userId = await authenticate(request)
  if (!userId) return apiError('Authentication required', 401)

  try {
    const parsed = ApiKeyRequest.safeParse(await request.json())
    if (!parsed.success) {
      return apiError('service and apiKey required', 400)
    }
    const { service, apiKey } = parsed.data

    // Hash the key before storing — raw keys are never persisted.
    const keyHash = createHash('sha256').update(apiKey).digest('hex')

    await prisma.userApiKey.upsert({
      where: { userId_service: { userId, service } },
      create: {
        userId,
        service,
        apiKey: keyHash,
        isActive: true,
        tier: 'free',
      },
      update: {
        apiKey: keyHash,
        isActive: true,
      },
    })

    return apiJson({ service, saved: true })
  } catch (err) {
    console.error('api-key save error:', err)
    return apiError('Failed to save API key', 500)
  }
}