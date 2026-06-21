// ─────────────────────────────────────────────────────────────
// GDELT News Fetcher — Tier 0, free
// Global event database: sentiment, geo filtering, themes
// Doc: https://blog.gdeltproject.org/gdelt-doc-2-0-api/
// ─────────────────────────────────────────────────────────────

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc'

const CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const fetchCache = new Map<string, { data: GdeltArticle[]; ts: number }>()

// ─── Types ─────────────────────────────────────────────────

export interface GdeltArticle {
  url: string
  url_mobile: string
  title: string
  seendate: string
  socialimage: string
  domain: string
  language: string
  sourcecountry: string
  sentiment: string
}

export interface GdeltSearchOptions {
  /** ISO country code for geo filtering (e.g. "ID", "KR") */
  country?: string
  /** GDELT tone threshold, e.g. "-5" for negative stories */
  tone?: string
  /** GDELT theme filter, e.g. "ECON", "TAX", "CRISIS" */
  theme?: string
  /** ISO language code */
  language?: string
  /** Max records (default 25, max 250) */
  maxRecords?: number
  /** Start date YYYYMMDDHHMMSS */
  startDateTime?: string
  /** End date YYYYMMDDHHMMSS */
  endDateTime?: string
}

// ─── GDELT Fetch ───────────────────────────────────────────

/**
 * Search GDELT for news articles matching a query.
 * Tier 0 — completely free, no API key required.
 */
export async function searchGdelt(
  query: string,
  options: GdeltSearchOptions = {},
): Promise<GdeltArticle[]> {
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    maxrecords: String(Math.min(options.maxRecords ?? 25, 250)),
    format: 'json',
  })

  if (options.country) params.set('query', `${query} sourcecountry:${options.country}`)
  if (options.tone) params.append('query', `tone:>${options.tone}`) // tone filtering
  if (options.theme) params.append('query', `theme:${options.theme}`)
  if (options.language) params.append('query', `sourcelang:${options.language}`)
  if (options.startDateTime) params.set('startdatetime', options.startDateTime)
  if (options.endDateTime) params.set('enddatetime', options.endDateTime)

  const cacheKey = params.toString()
  const cached = fetchCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  const url = `${GDELT_BASE}?${params.toString()}`

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) throw new Error(`GDELT ${res.status}`)

    const data = await res.json() as { articles?: GdeltArticle[] }
    const articles: GdeltArticle[] = data.articles ?? []

    fetchCache.set(cacheKey, { data: articles, ts: Date.now() })
    return articles
  } catch {
    return cached?.data ?? []
  }
}

/**
 * Get top news for a country. Falls back to global if country omitted.
 */
export async function getTopNews(country?: string): Promise<GdeltArticle[]> {
  const query = country ? `sourcecountry:${country}` : ''
  return searchGdelt(query || 'top news', { country, maxRecords: 25 })
}

/**
 * Get news by topic/theme (GDELT themes: ECON, CRISIS, ENV, etc.)
 */
export async function getNewsByTopic(topic: string): Promise<GdeltArticle[]> {
  return searchGdelt(topic, { theme: topic, maxRecords: 25 })
}
