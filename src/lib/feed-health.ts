// ─────────────────────────────────────────────────────────────
// Feed Health Monitor — validates every configured RSS feed and
// reports status. Used by the cron + the health dashboard.
// ─────────────────────────────────────────────────────────────
import { loadFeeds } from '@/lib/feed-config'

export interface FeedHealth {
  id: string
  url: string
  category: string
  ok: boolean
  status: number
  items: number
  entries: number
  isFeed: boolean
  bytes: number
  error: null | string
  ms: number
}

export interface FeedReport {
  generated: string
  total: number
  working: number
  atomOnly: number
  dead: number
  leakSuspect: number
  feeds: FeedHealth[]
}

const MARKUP = /<[a-z/][^>]*>/i

export async function checkFeed(url: string, timeoutMs = 12000): Promise<Omit<FeedHealth, 'id' | 'category'>> {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml', 'User-Agent': 'NexusBot/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { url, ok: false, status: res.status, items: 0, entries: 0, isFeed: false, bytes: 0, error: `HTTP ${res.status}`, ms: Date.now() - t0 }
    const xml = await res.text()
    const items = (xml.match(/<item[\s>]/gi) || []).length
    const entries = (xml.match(/<entry[\s>]/gi) || []).length
    const isFeed = /<\?xml|<rss|<feed|<rdf/i.test(xml.slice(0, 400))
    return { url, ok: isFeed && (items + entries) > 0, status: res.status, items, entries, isFeed, bytes: xml.length, error: null, ms: Date.now() - t0 }
  } catch (e) {
    return { url, ok: false, status: 0, items: 0, entries: 0, isFeed: false, bytes: 0, error: String(e).slice(0, 80), ms: Date.now() - t0 }
  }
}

export async function checkAllFeeds(): Promise<FeedReport> {
  const feeds = await loadFeeds()
  const results = await Promise.all(feeds.map(async (f) => {
    const r = await checkFeed(f.url)
    return { id: f.id, category: f.category, ...r } satisfies FeedHealth
  }))
  return {
    generated: new Date().toISOString(),
    total: results.length,
    working: results.filter((r) => r.ok).length,
    atomOnly: results.filter((r) => r.ok && r.entries > 0 && r.items === 0).length,
    dead: results.filter((r) => !r.ok).length,
    leakSuspect: 0, // markup check requires parsing; done in cron
    feeds: results,
  }
}

/** Check a single feed's parsed items for markup leaks. */
export async function checkFeedMarkup(url: string): Promise<{ items: number; leaking: number }> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'NexusBot/1.0' }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return { items: 0, leaking: 0 }
    const xml = await res.text()
    const blocks = xml.split(/<item[\s>]/).slice(1)
    let n = 0, leak = 0
    for (const b of blocks) {
      const desc = b.match(/<description[^>]*>([\s\S]*?)<\/description>/i)
      if (desc) {
        n++
        if (MARKUP.test(desc[1])) leak++
      }
    }
    return { items: n, leaking: leak }
  } catch {
    return { items: 0, leaking: 0 }
  }
}
