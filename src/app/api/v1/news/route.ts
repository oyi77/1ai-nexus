// ─────────────────────────────────────────────────────────────
// GET /api/v1/news — Aggregated news feed from RSS + Reddit
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') ?? undefined
  const limit = Number(searchParams.get('limit') ?? 30)

  try {
    const result = await registry.fetchOne<Array<{
      title: string
      link: string
      source: string
      publishedAt: string
      summary?: string
      category: string
    }>>('rss-engine', { category, limit })

    const items = (result.data ?? []).slice(0, limit).map((item, i) => ({
      id: `${item.source}-${i}-${Date.now()}`,
      title: item.title,
      url: item.link,
      sourceId: item.source,
      publishedAt: item.publishedAt,
      summary: item.summary,
      category: item.category,
    }))

    return NextResponse.json({ items, count: items.length, cached: result.cached })
  } catch {
    return NextResponse.json({ items: [], count: 0 })
  }
}
