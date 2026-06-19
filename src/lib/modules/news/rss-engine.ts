// ─────────────────────────────────────────────────────────────
// Module: RSS Engine
// sourceType: public-api
// Coverage: 10+ crypto + macro RSS feeds aggregated
// Background job: polls feeds, parses, deduplicates, stores
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

export interface RssItem {
  title: string
  link: string
  source: string
  publishedAt: string
  summary?: string
  category: 'crypto' | 'macro' | 'regulatory' | 'tradfi'
}

const FEEDS: Array<{ id: string; url: string; category: RssItem['category'] }> = [
  { id: 'coindesk',   url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',      category: 'crypto' },
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss',                    category: 'crypto' },
  { id: 'decrypt',    url: 'https://decrypt.co/feed',                              category: 'crypto' },
  { id: 'theblock',   url: 'https://www.theblock.co/rss.xml',                      category: 'crypto' },
  { id: 'blockworks', url: 'https://blockworks.co/feed',                           category: 'crypto' },
  { id: 'thedefiant', url: 'https://thedefiant.io/feed',                           category: 'crypto' },
  { id: 'fed-press',  url: 'https://www.federalreserve.gov/feeds/press_all.xml',   category: 'macro' },
  { id: 'sec-edgar',  url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&dateb=&owner=include&count=20&search_text=&output=atom', category: 'regulatory' },
  { id: 'bis',        url: 'https://www.bis.org/rss/home.htm',                     category: 'macro' },
  { id: 'imf',        url: 'https://www.imf.org/en/News/RSS',                      category: 'macro' },
  { id: 'treasury',   url: 'https://www.treasury.gov/resource-center/rss.xml',     category: 'macro' },
  { id: 'marketwatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', category: 'tradfi' },
  { id: 'cnbc',       url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069', category: 'tradfi' },
]

/** Parse RSS/Atom XML into items — minimal parser, no external deps */
function parseRssItems(xml: string, sourceId: string): RssItem[] {
  const items: RssItem[] = []
  // Match RSS <item> or Atom <entry>
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractLink(block)
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')
    const description = extractTag(block, 'description') || extractTag(block, 'summary')

    if (title && link) {
      items.push({
        title: cleanHtml(title),
        link,
        source: sourceId,
        publishedAt: pubDate || new Date().toISOString(),
        summary: description ? cleanHtml(description).slice(0, 500) : undefined,
        category: FEEDS.find(f => f.id === sourceId)?.category ?? 'crypto',
      })
    }
  }
  return items
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m?.[1]?.trim() ?? ''
}

function extractLink(xml: string): string {
  const m = xml.match(/<link[^>]*href="([^"]+)"/i)
  if (m) return m[1]
  return extractTag(xml, 'link')
}

function cleanHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

async function fetchRssFeed(feed: { id: string; url: string }): Promise<RssItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseRssItems(xml, feed.id)
  } catch {
    return []
  }
}

async function fetchAllFeeds(params: FetchParams): Promise<RssItem[]> {
  const category = params.category as string | undefined
  const feeds = category
    ? FEEDS.filter(f => f.category === category)
    : FEEDS

  const results = await Promise.allSettled(feeds.map(f => fetchRssFeed(f)))
  const items = results
    .filter((r): r is PromiseFulfilledResult<RssItem[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)

  return items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}

const rssEngineModule: DataModule = {
  id: 'rss-engine',
  name: 'RSS Engine',
  category: 'news',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'RSS aggregator — 10+ crypto, macro, regulatory, and tradfi feeds',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      // Test one feed
      const items = await fetchRssFeed(FEEDS[0])
      return {
        status: items.length > 0 ? 'active' : 'degraded',
        lastChecked: new Date(),
        lastSuccess: items.length > 0 ? new Date() : undefined,
        failureCount: items.length > 0 ? 0 : 1,
        notes: `${items.length} items from ${FEEDS[0].id}`,
      }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'rss-engine',
      params,
      TTL.NEWS,
      () => fetchAllFeeds(params) as Promise<T>,
    )
  },
}

export default rssEngineModule
export { FEEDS, fetchRssFeed }
