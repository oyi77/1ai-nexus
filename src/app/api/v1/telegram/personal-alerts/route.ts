// ─────────────────────────────────────────────────────────────
// POST /api/v1/telegram/personal-alerts — cron trigger
// Fires per-user watchlist alerts (cron calls this with the internal
// bearer). Self-authorizes via NEXUS_API_KEYS or TELEGRAM_CRON_SECRET,
// so it can live in middleware ALWAYS_PUBLIC without a session.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import { runPersonalWatchlistAlerts } from '@/lib/telegram/personal-alerts'

export const runtime = 'nodejs'

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
  if (!isInternalKey(request)) {
    return NextResponse.json(
      { data: null, error: 'Authentication required' },
      { status: 401 },
    )
  }
  const result = await runPersonalWatchlistAlerts()
  return NextResponse.json({ data: result, meta: null, error: null })
}

// GET keeps the health-check symmetry used by the broadcast route.
export async function GET(request: NextRequest) {
  if (!isInternalKey(request)) {
    return NextResponse.json(
      { data: null, error: 'Authentication required' },
      { status: 401 },
    )
  }
  const result = await runPersonalWatchlistAlerts()
  return NextResponse.json({ data: result, meta: null, error: null })
}
