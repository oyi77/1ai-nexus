// ─────────────────────────────────────────────────────────────
// Module: RSS Engine — Comprehensive Multi-Domain Feed Aggregator
// sourceType: public-api
// 60+ feeds: crypto, macro, regulatory, tradfi, tech, political,
// social, science, energy, geopolitical, Indonesia
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'

export type FeedCategory =
  | 'crypto' | 'macro' | 'regulatory' | 'tradfi'
  | 'tech' | 'political' | 'social' | 'science'
  | 'energy' | 'geopolitical' | 'indonesia'

export interface RssItem {
  title: string
  link: string
  source: string
  publishedAt: string
  summary?: string
  category: FeedCategory
}

const FEEDS: Array<{ id: string; url: string; category: FeedCategory }> = [
  // ─── Crypto ────────────────────────────────────────────────
  { id: 'coindesk',       url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',                 category: 'crypto' },
  { id: 'cointelegraph',  url: 'https://cointelegraph.com/rss',                                   category: 'crypto' },
  { id: 'decrypt',        url: 'https://decrypt.co/feed',                                         category: 'crypto' },
  { id: 'theblock',       url: 'https://www.theblock.co/rss.xml',                                 category: 'crypto' },
  { id: 'bitcoinmag',     url: 'https://bitcoinmagazine.com/.rss/full/',                          category: 'crypto' },
  { id: 'blockworks',     url: 'https://blockworks.co/feed',                                      category: 'crypto' },
  { id: 'unchained',      url: 'https://unchainedcrypto.com/feed/',                               category: 'crypto' },
  { id: 'the-defiant',    url: 'https://thedefiant.io/api/feed',                                  category: 'crypto' },
  { id: 'bankless',       url: 'https://www.bankless.com/feed',                                   category: 'crypto' },
  { id: 'dlnews',         url: 'https://www.dlnews.com/arc/outboundfeeds/rss/',                   category: 'crypto' },
  { id: 'rekt',           url: 'https://rekt.news/rss/feed.xml',                                  category: 'crypto' },
  { id: 'bitcoinist',     url: 'https://bitcoinist.com/feed/',                                    category: 'crypto' },

  // ─── Macro / Economics ─────────────────────────────────────
  { id: 'fed-rss',        url: 'https://www.federalreserve.gov/feeds/press_all.xml',              category: 'macro' },
  { id: 'ecb-press',      url: 'https://www.ecb.europa.eu/rss/press.html',                        category: 'macro' },
  { id: 'bls',            url: 'https://www.bls.gov/feed/bls_latest.rss',                         category: 'macro' },
  { id: 'bea',            url: 'https://apps.bea.gov/rss/rss.xml',                                category: 'macro' },
  { id: 'stlouisfed',     url: 'https://www.stlouisfed.org/on-the-economy/rss',                   category: 'macro' },

  // ─── Regulatory / Legal ────────────────────────────────────
  { id: 'treasury',       url: 'https://home.treasury.gov/rss/press-releases',                     category: 'regulatory' },
  { id: 'uk-fca',         url: 'https://www.fca.org.uk/news/rss.xml',                             category: 'regulatory' },
  { id: 'eu-esma',        url: 'https://www.esma.europa.eu/rss.xml',                              category: 'regulatory' },
  { id: 'sec-rss',        url: 'https://www.sec.gov/news/pressreleases.rss',                      category: 'regulatory' },
  { id: 'cftc',           url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml',                        category: 'regulatory' },
  { id: 'doj',            url: 'https://www.justice.gov/news/rss',                                category: 'regulatory' },
  { id: 'ecb-supervision', url: 'https://www.bankingsupervision.europa.eu/rss/press.html',        category: 'regulatory' },

  // ─── TradFi / Markets ──────────────────────────────────────
  { id: 'bloomberg',      url: 'https://feeds.bloomberg.com/markets/news.rss',                    category: 'tradfi' },
  { id: 'ft',             url: 'https://www.ft.com/?format=rss',                                  category: 'tradfi' },
  { id: 'wsj-markets',    url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',                   category: 'tradfi' },
  { id: 'cnbc',           url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',           category: 'tradfi' },
  { id: 'marketwatch',    url: 'https://feeds.marketwatch.com/marketwatch/topstories/',           category: 'tradfi' },
  { id: 'investing-com',  url: 'https://www.investing.com/rss/news.rss',                          category: 'tradfi' },
  { id: 'yahoo-fin',      url: 'https://finance.yahoo.com/news/rssindex',                         category: 'tradfi' },

  // ─── Tech ──────────────────────────────────────────────────
  { id: 'techcrunch',     url: 'https://techcrunch.com/feed/',                                    category: 'tech' },
  { id: 'arstechnica',    url: 'https://feeds.arstechnica.com/arstechnica/index',                 category: 'tech' },
  { id: 'verge',          url: 'https://www.theverge.com/rss/index.xml',                          category: 'tech' },
  { id: 'wired',          url: 'https://www.wired.com/feed/rss',                                  category: 'tech' },
  { id: 'hackernews',     url: 'https://hnrss.org/frontpage',                                     category: 'tech' },
  { id: 'mit-tech',       url: 'https://www.technologyreview.com/feed/',                          category: 'tech' },
  { id: 'theregister',    url: 'https://www.theregister.com/headlines.atom',                      category: 'tech' },
  { id: 'bleepingcomputer', url: 'https://www.bleepingcomputer.com/feed/',                        category: 'tech' },

  // ─── Political / Government ────────────────────────────────
  { id: 'congress',       url: 'https://www.congress.gov/rss/most-viewed-bills.xml',              category: 'political' },
  { id: 'eu-commission',  url: 'https://ec.europa.eu/commission/presscorner/api/rss?language=en',  category: 'political' },
  { id: 'thehill', url: 'https://thehill.com/feed/', category: 'political' },
  { id: 'axios', url: 'https://www.axios.com/feeds/feed.rss', category: 'political' },

  // ─── Social / Community ────────────────────────────────────
  { id: 'lobsters',       url: 'https://lobste.rs/rss',                                           category: 'social' },
  { id: 'hn-top', url: 'https://hnrss.org/newest?points=100', category: 'social' },
  { id: 'producthunt', url: 'https://www.producthunt.com/feed', category: 'social' },
  { id: 'devto', url: 'https://dev.to/feed', category: 'social' },

  // ─── Science / Research ────────────────────────────────────
  { id: 'nature',         url: 'https://www.nature.com/nature.rss',                               category: 'science' },
  { id: 'quantamagazine', url: 'https://www.quantamagazine.org/feed/',                            category: 'science' },
  { id: 'physorg', url: 'https://phys.org/rss-feed/', category: 'science' },
  { id: 'sciencedaily', url: 'https://www.sciencedaily.com/rss/all.xml', category: 'science' },
  { id: 'newscientist', url: 'https://www.newscientist.com/feed/home/', category: 'science' },

  // ─── Energy / Commodities ──────────────────────────────────
  { id: 'oilprice',       url: 'https://oilprice.com/rss/main',                                   category: 'energy' },
  { id: 'rigzone', url: 'https://www.rigzone.com/news/rss/rigzone_latest.aspx', category: 'energy' },

  // ─── Geopolitical ──────────────────────────────────────────
  { id: 'csis',           url: 'https://www.csis.org/rss.xml',                                    category: 'geopolitical' },
  { id: 'foreignpolicy',  url: 'https://foreignpolicy.com/feed/',                                 category: 'geopolitical' },
  { id: 'warontherocks', url: 'https://warontherocks.com/feed/', category: 'geopolitical' },
  { id: 'defensenews', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/', category: 'geopolitical' },
  { id: 'thediplomat', url: 'https://thediplomat.com/feed/', category: 'geopolitical' },
  { id: 'aljazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'geopolitical' },

  // ─── Indonesia ─────────────────────────────────────────────
  { id: 'bi',             url: 'https://www.bi.or.id/id/informasi-rss/Default.aspx',              category: 'indonesia' },
  { id: 'bappebti',       url: 'https://www.bappebti.go.id/rss',                                  category: 'indonesia' },
  { id: 'katadata',       url: 'https://katadata.co.id/rss',                                      category: 'indonesia' },
  { id: 'cnbc-indonesia', url: 'https://www.cnbcindonesia.com/rss',                               category: 'indonesia' },
  { id: 'detik-finance',  url: 'https://finance.detik.com/rss',                                   category: 'indonesia' },
  { id: 'tempo-bisnis',   url: 'https://rss.tempo.co/bisnis',                                     category: 'indonesia' },
  { id: 'antaranews-ekonomi', url: 'https://www.antaranews.com/rss/ekonomi.xml',                  category: 'indonesia' },
]

export function parseRssItems(xml: string, sourceId: string, category: FeedCategory): RssItem[] {
  const items: RssItem[] = []
  // RSS 2.0 <item> and Atom <entry>, each optionally carrying attributes
  // (`<item rdf:about="...">`). Matching a literal `<item>` skipped whole feeds:
  // Atom-only sources returned zero items no matter how healthy they were.
  const itemRegex = /<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractLink(block)
    const pubDate =
      extractTag(block, 'pubDate') ||
      extractTag(block, 'dc:date') ||
      // Atom dates
      extractTag(block, 'published') ||
      extractTag(block, 'updated') ||
      ''
    const summary = cleanHtml(
      extractTag(block, 'description') ||
        extractTag(block, 'content:encoded') ||
        // Atom bodies
        extractTag(block, 'summary') ||
        extractTag(block, 'content') ||
        '',
    )
    if (title) {
      items.push({
        title: cleanHtml(title),
        link,
        source: sourceId,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary: summary.slice(0, 500),
        category,
      })
    }
  }

  return items
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = xml.match(re)
  return m ? m[1].trim() : ''
}

function extractLink(xml: string): string {
  // RSS 2.0 <link>
  const linkTag = extractTag(xml, 'link')
  if (linkTag && linkTag.startsWith('http')) return linkTag
  // Atom: prefer rel="alternate" (the article) over rel="self"/"replies"
  const alternate = xml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
  if (alternate) return alternate[1]
  const atomLink = xml.match(/<link[^>]+href=["']([^"']+)["']/i)
  return atomLink ? atomLink[1] : ''
}

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&mdash;': '\u2014', '&ndash;': '\u2013', '&hellip;': '\u2026',
  '&rsquo;': '\u2019', '&lsquo;': '\u2018', '&ldquo;': '\u201c', '&rdquo;': '\u201d',
  '&euro;': '\u20ac', '&pound;': '\u00a3', '&deg;': '\u00b0', '&times;': '\u00d7',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z]+;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m)
}

export function cleanHtml(s: string): string {
  let out = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

  // Decode BEFORE stripping. Many feeds entity-encode their markup
  // (`&lt;span class="..."&gt;`), so a tags-first pass strips nothing and the
  // decode that follows re-materialises live HTML as visible article text.
  // Iterate so double-encoded content (`&amp;lt;`) collapses too.
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(out).replace(/<[^>]*>/g, ' ')
    if (next === out) break
    out = next
  }

  return out.replace(/\s+/g, ' ').trim()
}

async function fetchFeed(feed: { id: string; url: string; category: FeedCategory }): Promise<RssItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'NexusBot/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseRssItems(xml, feed.id, feed.category)
  } catch {
    return []
  }
}

// Sample max 40 feeds per cycle to keep response time predictable
const MAX_FEEDS_PER_CYCLE = 40

async function fetchAllFeeds(params: FetchParams): Promise<RssItem[]> {
  const category = params.category as FeedCategory | undefined
  const limit = (params.limit as number) ?? 200

  // Prefer hot-reloadable DB-backed config (falls back to file/builtin);
  // async load — sync FEEDS only if the loader import itself fails.
  let feedList: { id: string; url: string; category: FeedCategory }[]
  try {
    // Lazy require to avoid circular import
    const { loadFeeds } = require('@/lib/feed-config')
    feedList = await loadFeeds()
  } catch {
    feedList = FEEDS
  }

  let candidates = category
    ? feedList.filter(f => f.category === category)
    : feedList

  // Shuffle to avoid always hitting the same feeds first
  candidates = [...candidates].sort(() => Math.random() - 0.5).slice(0, MAX_FEEDS_PER_CYCLE)

  const results = await Promise.allSettled(candidates.map(f => fetchFeed(f)))
  const all = results
    .filter((r): r is PromiseFulfilledResult<RssItem[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)

  return all
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit)
}

const rssEngineModule: DataModule = {
  id: 'rss-engine',
  name: 'RSS Engine',
  category: 'news',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'RSS Engine — 60+ curated feeds across crypto, macro, regulatory, tradfi, tech, political, social, science, energy, geopolitical, Indonesia',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    // Quick check: fetch one reliable feed
    try {
      const items = await fetchFeed(FEEDS[0])
      return {
        status: items.length > 0 ? 'active' : 'degraded',
        lastChecked: new Date(),
        lastSuccess: items.length > 0 ? new Date() : undefined,
        failureCount: items.length > 0 ? 0 : 1,
        notes: items.length === 0 ? 'Feed returned no items' : undefined,
      }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('rss-engine', params, TTL.NEWS, () => fetchAllFeeds(params) as Promise<T>)
  },
}

export default rssEngineModule
export { FEEDS }
