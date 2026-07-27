// ─────────────────────────────────────────────────────────────
// POST /api/v1/telegram/broadcast — Trigger signal broadcast
// Called periodically (cron) to push new signals to subscribers
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { fetchAndBroadcastSignals } from '@/lib/telegram/signal-publisher'

// Simple bearer token check to prevent abuse
const CRON_SECRET = process.env.TELEGRAM_CRON_SECRET || ''

export async function POST(request: Request) {
  // Require authentication
  const auth = request.headers.get('authorization') || ''
  const body = await request.json().catch(() => ({})) as { secret?: string }
  const provided = auth.replace('Bearer ', '') || body.secret || ''

  if (CRON_SECRET && provided !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await fetchAndBroadcastSignals()
    return NextResponse.json({
      data: result,
      meta: {
        subscriberCount: (await import('@/lib/telegram/signal-publisher')).getSignalSubscriberCount(),
      },
      error: null,
    })
  } catch (err) {
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 500 },
    )
  }
}

// Also support GET with secret as query param for simple cronjob invocation
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret') || ''

  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await fetchAndBroadcastSignals()
    return NextResponse.json({
      data: result,
      meta: {
        subscriberCount: (await import('@/lib/telegram/signal-publisher')).getSignalSubscriberCount(),
      },
      error: null,
    })
  } catch (err) {
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 500 },
    )
  }
}
