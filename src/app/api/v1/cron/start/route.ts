// ─────────────────────────────────────────────────────────────
// GET /api/v1/cron/start — Start the price snapshot cron
// Called once on app startup
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { startPriceSnapshotCron } from '@/lib/modules/derived/price-cron'
import { getSnapshotCount, getSymbolCount } from '@/lib/modules/derived/price-store'

let started = false

export async function GET() {
  if (!started) {
    startPriceSnapshotCron()
    started = true
  }

  return NextResponse.json({
    status: 'running',
    snapshots: getSnapshotCount(),
    symbols: getSymbolCount(),
  })
}
