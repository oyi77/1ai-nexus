// ─────────────────────────────────────────────────────────────
// RSS Feed Registry — Country-aware, configurable feeds
// Follows src/lib/rss-feeds.ts pattern for consistency
// ─────────────────────────────────────────────────────────────

import type { SourceCredibility } from '@/lib/rss-feeds'

// ─── Types ─────────────────────────────────────────────────

export type CountryCode = 'ID' | 'KR' | 'GLOBAL'

export interface NewsFeed {
  id: string
  name: string
  url: string
  country: CountryCode
  language: string
  category: 'markets' | 'macro' | 'crypto' | 'general'
  credibility: SourceCredibility
  tags: string[]
}

export interface FetchedFeedItem {
  title: string
  link: string
  publishedAt: string
  summary?: string
  source: string
  sourceId: string
}

// ─── Feed Config ───────────────────────────────────────────

export const NEWS_FEEDS: NewsFeed[] = [
  // ── Indonesia ─────────────────────────────────────────────
  {
    id: 'kontan',
    name: 'Kontan',
    url: 'https://www.kontan.co.id/rss/forex',
    country: 'ID',
    language: 'id',
    category: 'markets',
    credibility: 'high',
    tags: ['forex', 'indonesia', 'rupiah', 'macro'],
  },
  {
    id: 'bisnis',
    name: 'Bisnis.com',
    url: 'https://www.bisnis.com/rss/finance',
    country: 'ID',
    language: 'id',
    category: 'markets',
    credibility: 'high',
    tags: ['finance', 'indonesia', 'stocks', 'banking'],
  },
  {
    id: 'cnbc-id',
    name: 'CNBC Indonesia',
    url: 'https://www.cnbcindonesia.com/market/rss',
    country: 'ID',
    language: 'id',
    category: 'markets',
    credibility: 'high',
    tags: ['market', 'indonesia', 'stocks', 'commodities'],
  },

  // ── Korea ─────────────────────────────────────────────────
  {
    id: 'naver-finance',
    name: 'Naver Finance',
    url: 'https://finance.naver.com/rss/news.naver?market=',
    country: 'KR',
    language: 'ko',
    category: 'markets',
    credibility: 'high',
    tags: ['korea', 'stocks', 'finance', 'kospi'],
  },
  {
    id: 'korea-herald-biz',
    name: 'Korea Herald Business',
    url: 'http://www.koreaherald.com/rss/020200000000.xml',
    country: 'KR',
    language: 'en',
    category: 'general',
    credibility: 'high',
    tags: ['korea', 'business', 'macro', 'trade'],
  },

  // ── Global / Crypto ───────────────────────────────────────
  {
    id: 'coindesk',
    name: 'CoinDesk',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    country: 'GLOBAL',
    language: 'en',
    category: 'crypto',
    credibility: 'high',
    tags: ['crypto', 'bitcoin', 'defi', 'regulation'],
  },
  {
    id: 'cointelegraph',
    name: 'CoinTelegraph',
    url: 'https://cointelegraph.com/rss',
    country: 'GLOBAL',
    language: 'en',
    category: 'crypto',
    credibility: 'medium',
    tags: ['crypto', 'altcoin', 'nft', 'web3'],
  },
  {
    id: 'reuters-business',
    name: 'Reuters Business',
    url: 'https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best',
    country: 'GLOBAL',
    language: 'en',
    category: 'macro',
    credibility: 'high',
    tags: ['macro', 'geopolitics', 'commodities', 'forex'],
  },
]

// ─── Feed Resolution ───────────────────────────────────────

/**
 * Get feeds filtered by country code.
 */
export function getFeedsByCountry(country: CountryCode): NewsFeed[] {
  return NEWS_FEEDS.filter((f) => f.country === country)
}

/**
 * Get all registered feeds.
 */
export function getAllFeeds(): NewsFeed[] {
  return [...NEWS_FEEDS]
}

/**
 * Fetch and parse an RSS feed URL into items.
 * Uses native DOMParser-compatible XML parsing — no external deps.
 */
export async function fetchFeed(url: string): Promise<FetchedFeedItem[]> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) throw new Error(`RSS ${res.status}`)

    const xml = await res.text()
    return parseRssXml(xml, url)
  } catch {
    return []
  }
}

// ─── XML Parser ────────────────────────────────────────────

function parseRssXml(xml: string, feedUrl: string): FetchedFeedItem[] {
  const items: FetchedFeedItem[] = []

  // Extract <item> blocks with a simple regex — avoids DOMParser dependency on server
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link') || extractTag(block, 'guid')
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'dc:date')
    const description = extractTag(block, 'description')

    if (!title || !link) continue

    items.push({
      title: decodeEntities(title),
      link: cleanCdata(link),
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      summary: description ? decodeEntities(stripHtml(description)).slice(0, 300) : undefined,
      source: feedUrl,
      sourceId: new URL(feedUrl).hostname,
    })
  }

  return items
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = re.exec(xml)
  return m?.[1]?.trim() ?? null
}

function cleanCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

function stripHtml(s: string): string {
  return cleanCdata(s).replace(/<[^>]+>/g, '')
}
