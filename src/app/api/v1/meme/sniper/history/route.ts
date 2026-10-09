// ─────────────────────────────────────────────────────────────
// GET  /api/v1/meme/sniper/history — persisted sniper decision log + the
//                                   daily stop-circuit state + status counts.
// POST /api/v1/meme/sniper/history — run one live scan pass on demand.
//
// Read access follows the meme-module convention: same-origin first-party
// browsers may read (third parties fall through to the API-key gate).
// The POST mutates state and can push Telegram alerts, so it additionally
// requires a signed-in session (nexus-session cookie) — never anonymous.
//
// Path is intentionally absent from PUBLIC_ROUTES: that keeps the API-key
// fall-through for external consumers instead of exposing the log publicly.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/jwt'
import { apiJson, apiError } from '@/lib/api/response'
import { readSniperLog, sniperLogCounts, appendSniperScan } from '@/lib/modules/derived/sniper-log'
import { readSniperCircuit, isSniperCircuitLocked } from '@/lib/modules/derived/sniper-circuit'
import { runSniperScan } from '@/lib/modules/derived/sniper-scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireUser(request: Request): Promise<string | null> {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('nexus-session='))
    ?.slice('nexus-session='.length)
  if (!token) return null
  const payload = await verifyToken(token)
  return payload?.userId ?? null
}

export async function GET() {
  const log = readSniperLog()
  return apiJson({
    entries: log.entries,
    updatedAt: log.updatedAt,
    lastScan: log.lastScan,
    counts: sniperLogCounts(log),
    circuit: { ...readSniperCircuit(), locked: isSniperCircuitLocked() },
  })
}

export async function POST(request: Request) {
  const userId = await requireUser(request)
  if (!userId) return apiError('Sign in to run a live snipe scan', 401)

  let body: { limit?: unknown; deliver?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const limit =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.min(Math.max(Math.floor(body.limit), 1), 10)
      : 3
  // Delivery is opt-in from the UI: a button click should not silently page
  // the operator's Telegram unless they asked for it.
  const deliver = body.deliver === true

  const result = await runSniperScan({ limit, deliver })
  const log = appendSniperScan(result)

  return NextResponse.json({
    data: {
      scanned: result.scanned,
      executed: result.executed,
      watchlisted: result.watchlisted,
      rejected: result.rejected,
      deduped: result.deduped,
      delivered: result.delivered,
      errors: result.errors,
      entries: log.entries,
      counts: sniperLogCounts(log),
      circuit: { ...readSniperCircuit(), locked: isSniperCircuitLocked() },
    },
    error: null,
  })
}
