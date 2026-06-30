// ─────────────────────────────────────────────────────────────
// Sentiment Intelligence Module
// Sources: Fear & Greed (alternative.me), Google Trends, Reddit
// All free, zero API keys required
// ─────────────────────────────────────────────────────────────
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'



export interface SentimentData {
  source: string
  score: number
  label: string
  metadata: Record<string, unknown>
  timestamp: string
}

// ─── Fear & Greed Index ────────────────────────────────────

async function fetchFearGreed(): Promise<SentimentData | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1&format=json', { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const data = await res.json() as { data?: Array<{ value: string; value_classification: string }> }
    const item = data.data?.[0]
    if (!item) return null
    return {
      source: 'fear-greed',
      score: parseInt(item.value, 10),
      label: item.value_classification,
      metadata: { raw: item.value },
      timestamp: new Date().toISOString(),
    }
  } catch { return null }
}

// ─── Google Trends (via proxy) ─────────────────────────────

async function fetchGoogleTrends(): Promise<SentimentData | null> {
  // Google Trends doesn't have a public API — use search volume proxy
  // This is a placeholder that returns a derived score from available data
  // In production, use pytrends or a proxy service
  try {
    // Use CoinGecko trending as a proxy for search interest
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const data = await res.json() as { coins?: Array<{ item: { name: string; score: number } }> }
    const trending = data.coins ?? []
    const avgScore = trending.length > 0
      ? trending.reduce((s, c) => s + (c.item.score ?? 0), 0) / trending.length
      : 50

    return {
      source: 'google-trends-proxy',
      score: Math.min(100, Math.round(avgScore)),
      label: avgScore > 70 ? 'High Interest' : avgScore > 40 ? 'Moderate Interest' : 'Low Interest',
      metadata: { trending: trending.slice(0, 5).map(c => c.item.name) },
      timestamp: new Date().toISOString(),
    }
  } catch { return null }
}

// ─── Reddit Velocity ───────────────────────────────────────

interface RedditPost {
  title: string
  score: number
  num_comments: number
  created_utc: number
  subreddit: string
}

async function fetchRedditVelocity(): Promise<SentimentData | null> {
  try {
    const res = await fetch('https://www.reddit.com/r/CryptoCurrency/hot.json?limit=25', {
      headers: { 'User-Agent': '1ai-nexus/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { data?: { children?: Array<{ data: RedditPost }> } }
    const posts = (data.data?.children ?? []).map(c => c.data)

    if (posts.length === 0) return null

    const avgScore = posts.reduce((s, p) => s + p.score, 0) / posts.length
    const avgComments = posts.reduce((s, p) => s + p.num_comments, 0) / posts.length
    const sentiment = posts.reduce((s, p) => {
      const lower = p.title.toLowerCase()
      if (/bull|moon|rally|pump|buy|accumulate/i.test(lower)) return s + 1
      if (/bear|crash|dump|sell|liquidat/i.test(lower)) return s - 1
      return s
    }, 0) / posts.length

    return {
      source: 'reddit',
      score: Math.round(50 + sentiment * 50),
      label: sentiment > 0.2 ? 'Bullish' : sentiment < -0.2 ? 'Bearish' : 'Neutral',
      metadata: {
        avgScore,
        avgComments,
        topPosts: posts.slice(0, 3).map(p => p.title),
        subreddit: 'r/CryptoCurrency',
      },
      timestamp: new Date().toISOString(),
    }
  } catch { return null }
}

// ─── Aggregate ─────────────────────────────────────────────

export async function fetchSentimentIntelligence(): Promise<SentimentData[]> {
  const [fg, trends, reddit] = await Promise.allSettled([
    fetchFearGreed(),
    fetchGoogleTrends(),
    fetchRedditVelocity(),
  ])

  const results: SentimentData[] = []
  if (fg.status === 'fulfilled' && fg.value) results.push(fg.value)
  if (trends.status === 'fulfilled' && trends.value) results.push(trends.value)
  if (reddit.status === 'fulfilled' && reddit.value) results.push(reddit.value)

  return results
}
export async function persistSentimentSnapshots(data: SentimentData[]): Promise<number> {
  let persisted = 0
  for (const item of data) {
    try {
      await prisma.sentimentSnapshot.create({
        data: {
          source: item.source,
          score: item.score,
          metadata: item.metadata as unknown as Prisma.InputJsonValue,
        },
      })
      persisted++
    } catch { /* skip duplicates or errors */ }
  }
  return persisted
}
