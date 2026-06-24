import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { detectClusters } from '@/lib/modules/derived/whale-clustering'

export async function GET() {
  try {
    const clusters = await detectClusters()
    return NextResponse.json({ data: clusters, count: clusters.length, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch (err) {
    return NextResponse.json({ data: [], error: (err as Error).message }, { status: 502 })
  }
}
