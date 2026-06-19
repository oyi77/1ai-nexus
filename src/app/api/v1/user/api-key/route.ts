// ─────────────────────────────────────────────────────────────
// GET /api/v1/user/api-key?service=anthropic
// Check if user has an API key configured for a service
// POST /api/v1/user/api-key — Save/update API key
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { z } from 'zod/v4'

const ApiKeyRequest = z.object({ service: z.string().min(1), apiKey: z.string().min(1) })

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const service = searchParams.get('service') ?? 'anthropic'

  // For now, check if the key exists in environment or DB
  // In production, this would check the UserApiKey table per-user
  const envKey = process.env.ANTHROPIC_API_KEY
  const hasKey = !!envKey && envKey.length > 0

  return NextResponse.json({ service, hasKey })
}

export async function POST(request: Request) {
  try {
    const parsed = ApiKeyRequest.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'service and apiKey required' }, { status: 400 })
    }
    const { service, apiKey } = parsed.data


    // In production: encrypt and store in UserApiKey table
    // For now: store in environment variable (runtime only)
    if (service === 'anthropic') {
      process.env.ANTHROPIC_API_KEY = apiKey
    }

    return NextResponse.json({ service, saved: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
