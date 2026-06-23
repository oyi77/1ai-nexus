// ─────────────────────────────────────────────────────────────
// GET /api/v1/alpha-cross-correlation
// Cross-correlation analysis of alpha signal types
// ?action=report|convergences|leading|strength
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import { fetchAlphaSignals } from '@/lib/modules/derived/alpha-feed'
import {
  ingestSignals,
  generateReport,
  resetCrossCorrelation,
  getBucketStore,
  type AlphaSignalInput,
  type SignalType,
} from '@/lib/modules/derived/alpha-cross-correlation'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'report'

  try {
    // 1. Always ingest fresh alpha signals into the bucket store
    const cached = await getCached('alpha-cross-corr-ingest', 15_000, async () => {
      const signals = await fetchAlphaSignals(100)
      const inputs: AlphaSignalInput[] = signals.map(s => ({
        id: s.id,
        type: s.type as SignalType,
        asset: s.asset,
        direction: s.direction,
        strength: s.strength,
        confidence: s.confidence,
        timestamp: s.timestamp instanceof Date ? s.timestamp : new Date(s.timestamp),
      }))
      ingestSignals(inputs)
      return { ingested: inputs.length }
    })

    const report = generateReport()

    if (action === 'convergences') {
      return NextResponse.json(
        { data: report.convergences, count: report.convergences.length, error: null },
        { headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' } },
      )
    }

    if (action === 'leading') {
      return NextResponse.json(
        { data: report.leadingIndicators, count: report.leadingIndicators.length, error: null },
        { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } },
      )
    }

    if (action === 'strength') {
      return NextResponse.json(
        { data: report.signalTypeStrength, error: null },
        { headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' } },
      )
    }

    if (action === 'buckets') {
      // Debug: raw bucket data
      const store = getBucketStore()
      const debug: Record<string, unknown> = {}
      for (const [type, buckets] of store) {
        debug[type] = {
          bucketCount: buckets.length,
          totalSignals: buckets.reduce((s, b) => s + b.count, 0),
          recent: buckets.slice(-5),
        }
      }
      return NextResponse.json(
        { data: debug, ingested: cached.data.ingested, error: null },
        { headers: { 'Cache-Control': 'public, max-age=10' } },
      )
    }

    if (action === 'reset') {
      resetCrossCorrelation()
      return NextResponse.json({ data: { message: 'Cross-correlation state reset' }, error: null })
    }

    // Default: full report
    return NextResponse.json(
      {
        data: {
          correlations: report.correlations,
          convergences: report.convergences,
          leadingIndicators: report.leadingIndicators,
          signalTypeStrength: report.signalTypeStrength,
          generatedAt: report.generatedAt.toISOString(),
          ingested: cached.data.ingested,
        },
        error: null,
      },
      { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } },
    )
  } catch (err) {
    console.error('[alpha-cross-correlation] error:', err)
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 502 },
    )
  }
}
