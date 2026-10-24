import 'dotenv/config'
import { prisma } from '@/lib/db'
import { ingestRssFeeds } from '@/lib/modules/news/rss-ingest'

async function main() {
  console.log('[ingest:news] starting RSS feed ingestion...')
  
  const initialCount = await prisma.newsArticle.count()
  console.log(`[ingest:news] initial NewsArticle count: ${initialCount}`)

  const result = await ingestRssFeeds({
    concurrency: 12,
    maxItemsPerFeed: 25,
    timeoutMs: 8000,
    batchSize: 100,
  })

  const finalCount = await prisma.newsArticle.count()

  console.log('[ingest:news] completed feed ingestion.')
  console.log(`[ingest:news] feeds processed: ${result.successfulFeeds}/${result.totalFeeds} (${result.failedFeeds} failed)`)
  console.log(`[ingest:news] total articles parsed: ${result.totalArticlesFetched}`)
  console.log(`[ingest:news] new articles persisted: ${result.newArticlesPersisted}`)
  console.log(`[ingest:news] final NewsArticle count in DB: ${finalCount}`)
  console.log(`[ingest:news] duration: ${(result.durationMs / 1000).toFixed(2)}s`)
}

main()
  .catch((err) => {
    console.error('[ingest:news] fatal error:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
