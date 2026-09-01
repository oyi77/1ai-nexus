// ─────────────────────────────────────────────────────────────
// POST /api/v1/telegram/subscribe — link a user to a Telegram chat
// Authed web call: derives userId from the JWT session when present.
// Also accepts an explicit userId when a valid API key / cron secret is supplied.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import { extractJwtSession } from '@/lib/jwt-middleware'
import { linkTelegram } from '@/lib/telegram/alert-service'

function isInternalKey(request: NextRequest): boolean {
  const cron = process.env.TELEGRAM_CRON_SECRET || ''
  const auth = request.headers.get('authorization') || ''
  if (cron && auth === `Bearer ${cron}`) return true
  const keys = new Set(
    process.env.NEXUS_API_KEYS?.split(',').map(k => k.trim()).filter(Boolean) ?? [],
  )
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return keys.size > 0 && keys.has(key)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    userId?: string
    chatId?: string
    username?: string
  }

  const session = extractJwtSession(request)
  const userId = session?.userId ?? body.userId

  if (!userId || !body.chatId) {
    return NextResponse.json(
      { data: null, error: 'userId and chatId are required' },
      { status: 400 },
    )
  }

  // If no session, require an internal credential before trusting body.userId.
  if (!session && !isInternalKey(request)) {
    return NextResponse.json(
      { data: null, error: 'Authentication required' },
      { status: 401 },
    )
  }

  const result = await linkTelegram(userId, body.chatId, body.username)
  return NextResponse.json({ data: result, meta: null, error: null })
}
