// ─────────────────────────────────────────────────────────────
// POST /api/v1/meme/sniper   — evaluate one on-chain payload, optionally
//                              push the alert to Telegram.
// GET  /api/v1/meme/sniper   — daily stop-circuit status (locked? streak?)
//
// Self-authenticating: NEXUS_API_KEYS / API_KEYS service keys or the
// TELEGRAM_CRON_SECRET bearer (same contract as /telegram/personal-alerts).
// Listed in middleware PUBLIC_ROUTES so the middleware does not 401 an
// internal caller before this handler can accept a service key.
//
// Body (POST):
//   { payload: SniperPayload, deliver?: boolean, positionSizeUsd?: number }
// The evaluator never trusts the caller's stage/status — it re-derives both.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { evaluateSniper, deliverSniperAlert, type SniperPayload } from '@/lib/modules/derived/meme-sniper'
import { isSniperCircuitLocked, readSniperCircuit } from '@/lib/modules/derived/sniper-circuit'

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

function isSniperPayload(v: unknown): v is SniperPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Partial<SniperPayload>
  return (
    typeof p.ticker === 'string' &&
    typeof p.contract === 'string' &&
    typeof p.ageMinutes === 'number' &&
    !!p.security &&
    typeof p.security === 'object' &&
    !!p.distribution &&
    typeof p.distribution === 'object' &&
    !!p.momentum &&
    typeof p.momentum === 'object' &&
    typeof p.momentum.marketCap === 'number' &&
    typeof p.momentum.volume5m === 'number'
  )
}

export async function GET(request: Request) {
  if (!isInternalKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const circuit = readSniperCircuit()
  return NextResponse.json({
    data: { ...circuit, locked: isSniperCircuitLocked() },
    error: null,
  })
}

export async function POST(request: Request) {
  if (!isInternalKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { payload?: unknown; deliver?: boolean; positionSizeUsd?: number }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isSniperPayload(body.payload)) {
    return NextResponse.json(
      { error: 'Invalid payload: ticker, contract, ageMinutes, security, distribution and momentum{marketCap,volume5m} are required' },
      { status: 400 },
    )
  }

  const decision = evaluateSniper(body.payload, {
    circuitLocked: isSniperCircuitLocked(),
    positionSizeUsd: body.positionSizeUsd,
  })

  // Only EXECUTE alerts are worth a push; REJECT noise trains the operator
  // to ignore the channel. WATCHLIST still notifies (it is actionable).
  let delivered = false
  if (body.deliver === true && decision.status !== 'REJECT') {
    delivered = await deliverSniperAlert(decision.alert)
  }

  return NextResponse.json({ data: { ...decision, delivered }, error: null })
}
