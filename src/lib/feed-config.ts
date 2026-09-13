// ─────────────────────────────────────────────────────────────
// Feed config loader — source of truth is the DB (admin-managed
// via /admin). Fallback chain: DB → data/feeds.json → compiled
// FEEDS. The file chain keeps the news pipeline alive when the
// DB is unreachable or not yet seeded, and gives ops a git-tracked
// bootstrap. The admin panel writes to the DB only.
// ─────────────────────────────────────────────────────────────
import { FEEDS as BUILTIN_FEEDS, type FeedCategory } from '@/lib/modules/news/rss/engine'
import { prisma } from '@/lib/db'
import fs from 'node:fs'
import path from 'node:path'

export interface FeedConfig {
  id: string
  url: string
  category: FeedCategory
}

const CONFIG_PATH = path.join(process.cwd(), 'data', 'feeds.json')

// DB reads are cheap but not free; the feed list rarely changes.
const DB_TTL_MS = 30_000

let dbCache: { feeds: FeedConfig[]; fetchedAt: number } | null = null

let fileCache: FeedConfig[] | null = null
let fileCachedMtime = 0

/** DB-first feed list. Never throws: falls back to file, then builtin. */
export async function loadFeeds(): Promise<FeedConfig[]> {
  try {
    if (dbCache && Date.now() - dbCache.fetchedAt < DB_TTL_MS) return dbCache.feeds
    const rows = await prisma.feed.findMany({
      where: { enabled: true },
      orderBy: { feedId: 'asc' },
      select: { feedId: true, url: true, category: true },
    })
    if (rows.length > 0) {
      const feeds = rows.map((r) => ({
        id: r.feedId,
        url: r.url,
        category: r.category as FeedCategory,
      }))
      dbCache = { feeds, fetchedAt: Date.now() }
      return feeds
    }
    // Table empty = not seeded yet → fall through to file chain.
  } catch {
    // DB unreachable → fall through to file chain.
  }
  return loadFeedsFromFile()
}

/** JSON file chain (hot-reloadable), then compiled builtin list. */
function loadFeedsFromFile(): FeedConfig[] {
  try {
    const stat = fs.statSync(CONFIG_PATH)
    if (fileCache && stat.mtimeMs === fileCachedMtime) return fileCache
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (Array.isArray(raw) && raw.length > 0 && raw[0].url) {
      fileCache = raw as FeedConfig[]
      fileCachedMtime = stat.mtimeMs
      return fileCache
    }
  } catch {
    // file missing or malformed — use builtin
  }
  fileCache = BUILTIN_FEEDS.map((f) => ({ id: f.id, url: f.url, category: f.category }))
  return fileCache!
}

/** Drop the DB cache so admin writes are visible immediately. */
export function invalidateFeedCache(): void {
  dbCache = null
}

export function getConfigPath(): string {
  return CONFIG_PATH
}
