// ─────────────────────────────────────────────────────────────
// POST /api/v1/meme/sniper/scan — one live sniper pass.
// GET  /api/v1/meme/sniper/scan — usage (POST-only contract).
//
// Discovers young dexscreener pairs, fans out audits, evaluates and
// optionally pushes EXECUTE/WATCHLIST alerts to Telegram. Bounded:
// `limit` clamps to 1..10.
//
// Auth: same self-authenticating service-key contract as /meme/sniper.
// Body (POST): { limit?: number, deliver?: boolean }
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { runSniperScan } from '@/lib/modules/derived/sniper-scan'

function parseServiceKeys(): Set<string> {
  const keys = new Set<string>()
  for (const env of ['NEXUS_API_KEYS', 'API_KEYS']) {
    for (const k of (process.env[env] || '').split(',')) {
      if (k.trim()) keys.add(k.trim())
    }
  }
  return keys
}

function isInternalKey(request: Request): boolean {
  const cron = process.env.TELEGRAM_CRON_SECRET || ''
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (cron && bearer === cron) return true
  if (bearer && parseServiceKeys().has(bearer)) return true
  const key = request.headers.get('x-api-key') || ''
  return key !== '' && parseServiceKeys().has(key)
}

export async function GET(request: Request) {
  if (!isInternalKey(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    data: { usage: 'POST { limit?: 1..10, deliver?: boolean }' },
    error: null,
  })
}

export async function POST(request: Request) {
  if (!isInternalKey(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { limit?: unknown; deliver?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const limit =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.min(Math.max(Math.floor(body.limit), 1), 10)
      : 3

  const deliver = body.deliver === true

  const result = await runSniperScan({ limit, deliver })
  return NextResponse.json({ data: result, error: null })
}
