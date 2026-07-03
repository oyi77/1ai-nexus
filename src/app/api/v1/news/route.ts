// ─────────────────────────────────────────────────────────────
// GET /api/v1/news — Aggregated news feed from RSS + Reddit
// Graceful degradation: returns empty array on failure, never 502
// ─────────────────────────────────────────────────────────────

import { apiSuccess } from '@/lib/api/response'
import { registerAllModules } from '@/lib/modules'

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') ?? undefined
  const limit = Number(searchParams.get('limit') ?? 30)

  let items: Array<{
    id: string
    title: string
    url: string
    sourceId: string
    publishedAt: string
    summary?: string
    category: string
  }> = []

  let cached = false

  try {
    const result = await registry.fetchOne<Array<{
      title: string
      link: string
      source: string
      publishedAt: string
      summary?: string
      category: string
    }>>('rss-engine', { category, limit })

    items = (result.data ?? []).slice(0, limit).map((item, i) => ({
      id: `${item.source}-${i}-${Date.now()}`,
      title: item.title,
      url: item.link,
      sourceId: item.source,
      publishedAt: item.publishedAt,
      summary: item.summary,
      category: item.category,
    }))
    cached = result.cached ?? false
  } catch (err) {
    // Graceful: return empty array instead of 502
    console.error('[news] Failed to fetch:', (err as Error).message)
  }

  const r = apiSuccess({ items, count: items.length, cached })
  r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  return r
}
