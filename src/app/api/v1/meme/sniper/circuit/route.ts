// ─────────────────────────────────────────────────────────────
// POST /api/v1/meme/sniper/circuit — record a sniper outcome.
// GET  /api/v1/meme/sniper/circuit — read the daily circuit state.
//
// Body (POST): { event: 'stop-loss' | 'win' | 'reset' }
// The third consecutive stop-loss of the UTC day locks snipe issuance
// until the day rolls over (or an explicit reset).
//
// Auth: same self-authenticating service-key contract as /meme/sniper.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  readSniperCircuit,
  recordSniperStopLoss,
  recordSniperWin,
  resetSniperCircuit,
} from '@/lib/modules/derived/sniper-circuit'

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
  // Accept: cron bearer, any NEXUS/API service key (middleware already
  // validated the bearer for non-public callers), or an explicit x-api-key.
  if (cron && bearer === cron) return true
  if (bearer && parseServiceKeys().has(bearer)) return true
  const key = request.headers.get('x-api-key') || ''
  return key !== '' && parseServiceKeys().has(key)
}

export async function GET(request: Request) {
  if (!isInternalKey(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ data: readSniperCircuit(), error: null })
}

export async function POST(request: Request) {
  if (!isInternalKey(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { event?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const event = body.event
  if (event === 'stop-loss') {
    return NextResponse.json({ data: recordSniperStopLoss(), error: null })
  }
  if (event === 'win') {
    return NextResponse.json({ data: recordSniperWin(), error: null })
  }
  if (event === 'reset') {
    return NextResponse.json({ data: resetSniperCircuit(), error: null })
  }
  return NextResponse.json({ error: "event must be 'stop-loss' | 'win' | 'reset'" }, { status: 400 })
}
