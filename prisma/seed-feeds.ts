// Seed the Feed registry from data/feeds.json (idempotent upsert).
// Run: npm run seed:feeds
import 'dotenv/config'
import { prisma } from '@/lib/db'
import fs from 'node:fs'
import path from 'node:path'

interface FeedConfig {
  id: string
  url: string
  category: string
}

const VALID_CATEGORIES = new Set([
  'crypto', 'macro', 'regulatory', 'tradfi', 'tech', 'political',
  'social', 'science', 'energy', 'geopolitical', 'indonesia',
])

async function main() {
  const configPath = path.join(process.cwd(), 'data', 'feeds.json')
  const raw: FeedConfig[] = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('feeds.json empty or malformed')

  const seen = new Set<string>()
  let upserts = 0
  for (const f of raw) {
    if (!f.id || !f.url || !VALID_CATEGORIES.has(f.category)) {
      console.warn(`[seed:feeds] skip invalid entry: ${JSON.stringify(f).slice(0, 80)}`)
      continue
    }
    if (seen.has(f.id)) throw new Error(`duplicate id in feeds.json: ${f.id}`)
    seen.add(f.id)
    await prisma.feed.upsert({
      where: { feedId: f.id },
      create: { feedId: f.id, url: f.url, category: f.category },
      update: { url: f.url, category: f.category }, // enabled untouched on re-seed
    })
    upserts++
  }

  // Remove DB rows whose feedId vanished from the file (keeps DB == file on full reseed)
  const existing = await prisma.feed.findMany({ select: { feedId: true } })
  const stale = existing.filter((e) => !seen.has(e.feedId)).map((e) => e.feedId)
  if (stale.length > 0) {
    const res = await prisma.feed.deleteMany({ where: { feedId: { in: stale } } })
    console.log(`[seed:feeds] removed ${res.count} stale rows: ${stale.join(', ')}`)
  }

  console.log(`[seed:feeds] upserted ${upserts} feeds from feeds.json`)
}

main()
  .catch((e) => { console.error('[seed:feeds] failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
