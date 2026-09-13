// ─────────────────────────────────────────────────────────────
// Feed config loader — reads feed list from data/feeds.json
// Falls back to the compiled FEEDS if the file is absent.
// Allows swapping dead feeds without a code change + deploy.
// ─────────────────────────────────────────────────────────────
import { FEEDS as BUILTIN_FEEDS, type FeedCategory } from '@/lib/modules/news/rss/engine'
import fs from 'node:fs'
import path from 'node:path'

interface FeedConfig {
  id: string
  url: string
  category: FeedCategory
}

const CONFIG_PATH = path.join(process.cwd(), 'data', 'feeds.json')

let cached: FeedConfig[] | null = null
let cachedMtime = 0

export function loadFeeds(): FeedConfig[] {
  try {
    const stat = fs.statSync(CONFIG_PATH)
    if (cached && stat.mtimeMs === cachedMtime) return cached
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (Array.isArray(raw) && raw.length > 0 && raw[0].url) {
      cached = raw as FeedConfig[]
      cachedMtime = stat.mtimeMs
      return cached
    }
  } catch {
    // file missing or malformed — use builtin
  }
  cached = BUILTIN_FEEDS.map((f) => ({ id: f.id, url: f.url, category: f.category }))
  return cached!
}

export function getConfigPath(): string {
  return CONFIG_PATH
}
