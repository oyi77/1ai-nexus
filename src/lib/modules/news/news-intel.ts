import { prisma } from '@/lib/db'
import {
  extractAssetEntities,
  classifySentimentDirection,
  ingestRssFeeds,
} from './rss-ingest'

export interface NewsEvent {
  source: string
  headline: string
  url: string
  entities: string[]
  relevanceScore: number
  severityScore: number
  direction: 'bullish' | 'bearish' | 'neutral'
  publishedAt: string
  category: string
}

export interface ExchangeStatus {
  exchange: string
  status: string
  message: string
  updatedAt: string
}

async function fetchGDELT(query = 'cryptocurrency OR bitcoin OR ethereum'): Promise<NewsEvent[]> {
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=25&format=json&sort=date`
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return []
    const data = await res.json() as { articles?: Array<{ title: string; url: string; seendate: string; language: string; sourcecountry: string }> }

    return (data.articles ?? []).map(a => ({
      source: 'GDELT',
      headline: a.title,
      url: a.url,
      entities: extractAssetEntities(a.title),
      relevanceScore: computeRelevance(a.title),
      severityScore: computeSeverity(a.title),
      direction: classifySentimentDirection(a.title).direction,
      publishedAt: a.seendate,
      category: 'news',
    }))
  } catch {
    return []
  }
}

async function fetchSECFilings(): Promise<NewsEvent[]> {
  try {
    const url = 'https://efts.sec.gov/LATEST/search-index?q=%228-K%22&dateRange=custom&startdt=' +
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) +
      '&enddt=' + new Date().toISOString().slice(0, 10) + '&forms=8-K&limit=10'
    const res = await fetch(url, {
      headers: { 'User-Agent': '1ai-nexus/1.0 (contact@1ai-nexus.com)' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { filings?: Array<{ title: string; filed: string; form_type: string }> }

    return (data.filings ?? []).map(f => ({
      source: 'SEC EDGAR',
      headline: f.title,
      url: '',
      entities: extractAssetEntities(f.title),
      relevanceScore: 0.7,
      severityScore: 0.6,
      direction: classifySentimentDirection(f.title).direction,
      publishedAt: f.filed,
      category: 'regulatory',
    }))
  } catch {
    return []
  }
}

async function fetchExchangeStatuses(): Promise<ExchangeStatus[]> {
  const statuses: ExchangeStatus[] = []
  try {
    const res = await fetch('https://api.binance.com/sapi/v1/system/status', { signal: AbortSignal.timeout(5_000) })
    if (res.ok) {
      const data = await res.json() as { status?: string; msg?: string }
      statuses.push({
        exchange: 'Binance',
        status: data.status === 'normal' ? 'operational' : 'degraded',
        message: data.msg ?? 'System operational',
        updatedAt: new Date().toISOString(),
      })
    }
  } catch {
    statuses.push({ exchange: 'Binance', status: 'unknown', message: 'Status check failed', updatedAt: new Date().toISOString() })
  }
  return statuses
}

export function extractEntities(text: string): string[] {
  return extractAssetEntities(text)
}

export function computeRelevance(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.3
  if (/bitcoin|btc|ethereum|eth|crypto|saham|ihsg|bbca|bbri/i.test(lower)) score += 0.3
  if (/price|market|rally|crash|surge|plunge|laba|dividen/i.test(lower)) score += 0.2
  if (/sec|regulation|etf|approval|listing|bappebti|ojk|bi/i.test(lower)) score += 0.2
  return Math.min(1, score)
}

export function computeSeverity(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.2
  if (/crash|hack|exploit|ban|lawsuit|fraud|anjlok|gugatan|sanksi/i.test(lower)) score += 0.5
  if (/rally|surge|approval|record|all-time|rekor|melonjak/i.test(lower)) score += 0.3
  return Math.min(1, score)
}

export function classifyDirection(text: string): 'bullish' | 'bearish' | 'neutral' {
  return classifySentimentDirection(text).direction
}

export async function fetchNewsIntelligence(): Promise<{ events: NewsEvent[]; exchangeStatuses: ExchangeStatus[] }> {
  const [dbArticlesResult, gdeltEvents, secEvents, exchangeStatuses] = await Promise.allSettled([
    prisma.newsArticle.findMany({
      take: 50,
      orderBy: { publishedAt: 'desc' },
      select: {
        sourceId: true,
        title: true,
        url: true,
        assets: true,
        sentiment: true,
        category: true,
        publishedAt: true,
      },
    }),
    fetchGDELT(),
    fetchSECFilings(),
    fetchExchangeStatuses(),
  ])

  const dbEvents: NewsEvent[] = dbArticlesResult.status === 'fulfilled'
    ? dbArticlesResult.value.map(a => ({
        source: a.sourceId,
        headline: a.title,
        url: a.url,
        entities: a.assets,
        relevanceScore: computeRelevance(a.title),
        severityScore: computeSeverity(a.title),
        direction: (a.sentiment as 'bullish' | 'bearish' | 'neutral') || 'neutral',
        publishedAt: a.publishedAt.toISOString(),
        category: a.category,
      }))
    : []

  const externalEvents = [
    ...(gdeltEvents.status === 'fulfilled' ? gdeltEvents.value : []),
    ...(secEvents.status === 'fulfilled' ? secEvents.value : []),
  ]

  const merged = [...dbEvents, ...externalEvents].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )

  const seenUrls = new Set<string>()
  const events: NewsEvent[] = []
  for (const item of merged) {
    const key = item.url || `${item.source}-${item.headline}`
    if (seenUrls.has(key)) continue
    seenUrls.add(key)
    events.push(item)
    if (events.length >= 50) break
  }

  return {
    events,
    exchangeStatuses: exchangeStatuses.status === 'fulfilled' ? exchangeStatuses.value : [],
  }
}

export async function persistNewsEvents(events: NewsEvent[]): Promise<number> {
  if (!events || events.length === 0) return 0
  const validEvents = events.filter(e => e.headline && e.url)
  if (validEvents.length === 0) return 0

  const seen = new Set<string>()
  const deduped = validEvents.filter(e => {
    if (seen.has(e.url)) return false
    seen.add(e.url)
    return true
  })

  try {
    const res = await prisma.newsArticle.createMany({
      data: deduped.map(e => {
        const d = new Date(e.publishedAt)
        return {
          sourceId: e.source,
          title: e.headline,
          url: e.url,
          publishedAt: isNaN(d.getTime()) ? new Date() : d,
          assets: e.entities,
          sentiment: e.direction,
          category: e.category,
        }
      }),
      skipDuplicates: true,
    })
    return res.count
  } catch {
    let count = 0
    for (const e of deduped) {
      try {
        const d = new Date(e.publishedAt)
        await prisma.newsArticle.create({
          data: {
            sourceId: e.source,
            title: e.headline,
            url: e.url,
            publishedAt: isNaN(d.getTime()) ? new Date() : d,
            assets: e.entities,
            sentiment: e.direction,
            category: e.category,
          },
        })
        count++
      } catch {}
    }
    return count
  }
}

export {
  ingestRssFeeds,
  extractAssetEntities,
  classifySentimentDirection,
}
