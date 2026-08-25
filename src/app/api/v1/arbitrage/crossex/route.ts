// ─────────────────────────────────────────────────────────────
// GET /api/v1/arbitrage/crossex — Gate CrossEx funding-rate arbitrage
// snapshot, captured periodically by src/scripts/crossex-harvest.ts
// (headless Chrome via xvfb; Akamai blocks direct server fetches).
//
// Response: { data: snapshot | null, error, meta: { ageMinutes, stale } }
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

const SNAPSHOT = () => join(process.cwd(), 'data', 'crossex', 'snapshot.json')
const STALE_AFTER_MS = 2 * 60 * 60 * 1000 // 2h without a fresh harvest → stale

export async function GET() {
  try {
    const file = SNAPSHOT()
    if (!existsSync(file)) {
      return NextResponse.json(
        { data: null, error: 'No CrossEx snapshot yet — harvester has not run on this host.', meta: null },
        { status: 503 },
      )
    }

    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const ageMs = Math.max(0, Date.now() - statSync(file).mtimeMs)
    const meta = {
      ageMinutes: Math.round(ageMs / 60_000),
      stale: ageMs > STALE_AFTER_MS,
      capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : null,
      total: typeof raw.total === 'number' ? raw.total : null,
      captured: typeof raw.captured === 'number' ? raw.captured : null,
    }

    return NextResponse.json({ data: raw, error: null, meta })
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : 'Failed to read CrossEx snapshot', meta: null },
      { status: 500 },
    )
  }
}
