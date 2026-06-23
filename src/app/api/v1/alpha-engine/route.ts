// ─────────────────────────────────────────────────────────────
// GET /api/v1/alpha-engine — Alpha signals from cross-correlation
// Combines trade flow, whale alerts, funding, sentiment
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getAlphaSignals } from '@/lib/modules/derived/alpha-engine'

export async function GET() {
  try {
    const result = await getAlphaSignals()
    const resp = NextResponse.json({ data: result, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    return resp
  } catch (error) {
    console.error('Alpha engine error:', error)
    return NextResponse.json({ data: null, error: 'Failed to generate alpha signals' }, { status: 502 })
  }
}