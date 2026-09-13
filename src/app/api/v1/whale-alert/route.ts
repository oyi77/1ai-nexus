// ─────────────────────────────────────────────────────────────
// GET /api/v1/whale-alert — Multi-chain whale alerts
// Scraped from Whale Alert Telegram channel (zero API key)
// Server-side cached: 30s TTL, single-flight dedup; warmed by the
// background refresher (see data-refresher.ts) so cold restarts
// serve cache instead of 502 while the upstream blips.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import { fetchWhaleAlerts, type WhaleAlertItem } from '@/lib/modules/onchain/whale-alert/fetcher'

export async function GET() {
  try {
    const { data, fromCache } = await getCached('whale-alert', 30_000, fetchWhaleAlerts)
    const resp = NextResponse.json({ data: { items: (data as WhaleAlertItem[]).slice(0, 20), count: data.length }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Whale Alert error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch Whale Alerts' }, { status: 502 })
  }
}
