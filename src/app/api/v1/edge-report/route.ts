import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { generateEdgeReport, getCachedReport } from '@/lib/modules/derived/edge-report'

export async function GET() {
  try {
    // Return cached if fresh, otherwise generate
    const cached = getCachedReport()
    if (cached) {
      return NextResponse.json({ data: cached, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
      })
    }

    const report = await generateEdgeReport()
    return NextResponse.json({ data: report, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 502 })
  }
}
