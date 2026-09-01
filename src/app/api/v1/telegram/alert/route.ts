// ─────────────────────────────────────────────────────────────
// POST /api/v1/telegram/alert — send a personal Telegram alert to a user
// Authorized: the user themselves (session matching body.userId), an admin,
// or an internal credential (TELEGRAM_CRON_SECRET / API key).
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import { extractJwtSession } from '@/lib/jwt-middleware'
import { sendUserAlert } from '@/lib/telegram/alert-service'

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
    message?: string
  }

  if (!body.userId || !body.message) {
    return NextResponse.json(
      { data: null, error: 'userId and message are required' },
      { status: 400 },
    )
  }

  const session = extractJwtSession(request)
  const isSelf = session?.userId === body.userId
  const isAdmin = session?.role === 'admin'

  // The user can fire their own alert; an admin or internal credential can fire for anyone.
  if (!isSelf && !isAdmin && !isInternalKey(request)) {
    return NextResponse.json(
      { data: null, error: 'Authentication required' },
      { status: 401 },
    )
  }

  const result = await sendUserAlert(body.userId, body.message)
  return NextResponse.json({ data: result, meta: null, error: null })
}
