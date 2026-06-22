// ─────────────────────────────────────────────────────────────
// GET /api/v1/news-intel — News Intelligence API
// Actions: gdelt, rss, local-exclusive
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { searchGdelt, getTopNews } from '@/lib/dal/news/gdelt'
import { getFeedsByCountry, getAllFeeds, type CountryCode } from '@/lib/dal/news/rss-registry'
import { calculateLocalScore, isLocalExclusive } from '@/lib/dal/news/local-score'

export const dynamic = 'force-dynamic'

// ─── Handler ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'gdelt'

  try {
    switch (action) {
      case 'gdelt': {
        const r = await handleGdelt(searchParams)
        r.headers.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240')
        return r
      }
      case 'rss': {
        const r = handleRss(searchParams)
        r.headers.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240')
        return r
      }
      case 'local-exclusive': {
        const r = await handleLocalExclusive(searchParams)
        r.headers.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240')
        return r
      }
      default:
        return apiError(`Unknown action: ${action}. Use gdelt, rss, or local-exclusive.`, 400)
    }
  } catch (err) {
    return apiError(`News intel error: ${(err as Error).message}`, 500)
  }
}

// ─── GDELT Search ─────────────────────────────────────────

async function handleGdelt(searchParams: URLSearchParams) {
  const q = searchParams.get('q')
  const country = searchParams.get('country') ?? undefined
  const theme = searchParams.get('theme') ?? undefined
  const language = searchParams.get('language') ?? undefined
  const maxRecords = Math.min(Number(searchParams.get('limit') ?? 25), 100)

  // If no query, get top news for country
  const articles = q
    ? await searchGdelt(q, { country, theme, language, maxRecords })
    : await getTopNews(country)

  return apiSuccess({
    action: 'gdelt',
    query: q,
    country: country ?? 'global',
    count: articles.length,
    articles: articles.map((a) => ({
      title: a.title,
      url: a.url,
      source: a.domain,
      country: a.sourcecountry,
      language: a.language,
      publishedAt: a.seendate,
      sentiment: a.sentiment,
      imageUrl: a.socialimage,
    })),
  })
}

// ─── RSS Feeds ─────────────────────────────────────────────

function handleRss(searchParams: URLSearchParams) {
  const country = (searchParams.get('country') ?? 'GLOBAL').toUpperCase()
  const feeds = country === 'ALL' ? getAllFeeds() : getFeedsByCountry(country as CountryCode)

  if (feeds.length === 0) {
    return apiError(`No feeds registered for country: ${country}`, 404)
  }

  return apiSuccess({
    action: 'rss',
    country,
    feedCount: feeds.length,
    feeds: feeds.map((f) => ({
      id: f.id,
      name: f.name,
      url: f.url,
      country: f.country,
      language: f.language,
      category: f.category,
      credibility: f.credibility,
    })),
    note: 'Use ?action=rss&fetch=<feed-url> to fetch feed content',
  })
}

// ─── Local Exclusive ───────────────────────────────────────

async function handleLocalExclusive(searchParams: URLSearchParams) {
  const country = (searchParams.get('country') ?? 'ID').toUpperCase()
  const minScore = Number(searchParams.get('minScore') ?? 70)

  // Fetch recent news from GDELT for the country
  const articles = await getTopNews(country)

  // Score each article for local exclusivity
  const scored = articles.map((a) => {
    const item = {
      source: a.domain,
      country: a.sourcecountry || country,
      headline: a.title,
      publishedAt: new Date(a.seendate),
      url: a.url,
      entities: [], // GDELT basic tier doesn't provide entity arrays
    }

    const result = calculateLocalScore(item)

    return {
      title: a.title,
      url: a.url,
      source: a.domain,
      publishedAt: a.seendate,
      localOnlyScore: result.localOnlyScore,
      isCrossBorder: result.isCrossBorder,
      minutesSincePublish: result.minutesSincePublish,
      reasons: result.reasons,
      isLocalExclusive: isLocalExclusive(item),
    }
  })

  // Filter to high local-only scores
  const exclusive = scored.filter((s) => s.localOnlyScore >= minScore)

  return apiSuccess({
    action: 'local-exclusive',
    country,
    minScore,
    totalScanned: articles.length,
    exclusiveCount: exclusive.length,
    items: exclusive,
  })
}
