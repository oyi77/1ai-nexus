// ─────────────────────────────────────────────────────────────
// /api/v1/admin/feeds — Admin-managed RSS feed registry CRUD.
//
// GET            list all feeds + last health event + 7d/30d uptime
// POST           create feed { feedId, url, category }
// PATCH          update { id, url?, category?, enabled? }
// DELETE         remove feed (?id=)
//
// Every mutation invalidates the loader cache so the RSS engine
// picks up the new list on the next request (30s TTL anyway).
// Auth: admin JWT (middleware PROTECTED_ROUTES + role check).
// ─────────────────────────────────────────────────────────────
import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'
import { invalidateFeedCache } from '@/lib/feed-config'
import { FeedCategory } from '@/lib/modules/news/rss/engine'

export const dynamic = 'force-dynamic'

const CATEGORIES: readonly string[] = [
  'crypto', 'macro', 'regulatory', 'tradfi', 'tech', 'political',
  'social', 'science', 'energy', 'geopolitical', 'indonesia',
] satisfies readonly FeedCategory[]

const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}$/
const URL_RE = /^https?:\/\/\S+$/

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  try {
    const feeds = await prisma.feed.findMany({
      orderBy: [{ category: 'asc' }, { feedId: 'asc' }],
    })
    const since7d = new Date(Date.now() - 7 * 864e5)
    const since30d = new Date(Date.now() - 30 * 864e5)
    const [u7, u30, last, allFeeds] = await Promise.all([
      prisma.feedHealthEvent.groupBy({
        by: ['feedId'],
        where: { checkedAt: { gte: since7d } },
        _count: { _all: true, ok: true },
      }),
      prisma.feedHealthEvent.groupBy({
        by: ['feedId'],
        where: { checkedAt: { gte: since30d } },
        _count: { _all: true, ok: true },
      }),
      prisma.feedHealthEvent.findMany({
        orderBy: { checkedAt: 'desc' },
        distinct: ['feedId'],
        select: { feedId: true, ok: true, status: true, error: true, ms: true, checkedAt: true },
      }),
      prisma.feed.findMany({ select: { id: true, feedId: true } }),
    ])

    // FeedHealthEvent.feedId stores the Feed PK; join to the slug for display
    const pkToSlug = new Map(allFeeds.map((f) => [f.id, f.feedId]))
    const pct = (g: { _count: { _all: number; ok: number } }): number | null =>
      g._count._all > 0 ? Math.round((g._count.ok / g._count._all) * 100) : null
    const map7 = new Map(u7.map((g) => [pkToSlug.get(g.feedId) ?? g.feedId, pct(g)]))
    const map30 = new Map(u30.map((g) => [pkToSlug.get(g.feedId) ?? g.feedId, pct(g)]))
    const lastMap = new Map(
      last
        .map((e) => ({ ...e, slug: pkToSlug.get(e.feedId) }))
        .filter((e): e is typeof e & { slug: string } => !!e.slug)
        .map((e) => [e.slug, e]),
    )

    return apiJson({
      feeds: feeds.map((f) => ({
        ...f,
        uptime7d: map7.get(f.feedId) ?? null,
        uptime30d: map30.get(f.feedId) ?? null,
        lastCheck: lastMap.get(f.feedId) ?? null,
      })),
      total: feeds.length,
      enabled: feeds.filter((f) => f.enabled).length,
    })
  } catch (err) {
    console.error('[admin/feeds] list error:', err)
    return apiError('Failed to fetch feeds', 500)
  }
}

interface FeedBody {
  feedId?: string
  url?: string
  category?: string
  enabled?: boolean
}

function validate(body: FeedBody, forCreate: boolean): string | null {
  if (forCreate || body.feedId !== undefined) {
    if (!body.feedId || !ID_RE.test(body.feedId)) return 'feedId must be 2-49 chars: lowercase letters, digits, hyphens'
  }
  if (forCreate || body.url !== undefined) {
    if (!body.url || !URL_RE.test(body.url)) return 'url must be an http(s) URL'
  }
  if (forCreate || body.category !== undefined) {
    if (!body.category || !CATEGORIES.includes(body.category)) {
      return `category must be one of: ${CATEGORIES.join(', ')}`
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  try {
    const body = (await request.json()) as FeedBody
    const err = validate(body, true)
    if (err) return apiError(err, 400)

    const existing = await prisma.feed.findUnique({ where: { feedId: body.feedId! } })
    if (existing) return apiError(`Feed id "${body.feedId}" already exists`, 409)

    const feed = await prisma.feed.create({
      data: {
        feedId: body.feedId!,
        url: body.url!,
        category: body.category!,
        enabled: body.enabled ?? true,
      },
    })
    invalidateFeedCache()
    return apiJson({ feed }, { status: 201 })
  } catch (err) {
    console.error('[admin/feeds] create error:', err)
    return apiError('Failed to create feed', 500)
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  try {
    const body = (await request.json()) as FeedBody & { id?: string }
    if (!body.id) return apiError('id is required', 400)
    const err = validate(body, false)
    if (err) return apiError(err, 400)

    const data: { url?: string; category?: string; enabled?: boolean } = {}
    if (body.url !== undefined) data.url = body.url
    if (body.category !== undefined) data.category = body.category
    if (body.enabled !== undefined) data.enabled = body.enabled
    if (Object.keys(data).length === 0) return apiError('nothing to update', 400)

    const feed = await prisma.feed.update({ where: { id: body.id }, data })
    invalidateFeedCache()
    return apiJson({ feed })
  } catch (err) {
    console.error('[admin/feeds] update error:', err)
    return apiError('Failed to update feed (bad id?)', 500)
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return apiError('id query param is required', 400)
    await prisma.feed.delete({ where: { id } })
    invalidateFeedCache()
    return apiJson({ deleted: true })
  } catch (err) {
    console.error('[admin/feeds] delete error:', err)
    return apiError('Failed to delete feed (bad id?)', 500)
  }
}
