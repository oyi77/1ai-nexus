// ─────────────────────────────────────────────────────────────
// GET /api/v1/sentiment — News sentiment scoring
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'
import { scoreSentiment, detectAssets } from '@/lib/modules/derived/sentiment-engine'

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const limit = Math.min(50, Math.max(10, Number(searchParams.get('limit') ?? 30)))

  try {
    const result = await registry.fetchOne<Array<{
      title: string
      summary?: string
      source: string
      publishedAt: string
      category: string
    }>>('rss-engine', { limit: String(limit) })

    const items = (result.data ?? []).map(item => {
      const text = `${item.title} ${item.summary ?? ''}`
      const sentiment = scoreSentiment(text)
      const assets = detectAssets(text)

      return {
        title: item.title,
        source: item.source,
        publishedAt: item.publishedAt,
        category: item.category,
        sentiment,
        assets,
      }
    })

    // Aggregate sentiment
    const bullCount = items.filter(i => i.sentiment.label === 'bullish').length
    const bearCount = items.filter(i => i.sentiment.label === 'bearish').length
    const avgScore = items.length > 0 ? items.reduce((sum, i) => sum + i.sentiment.score, 0) / items.length : 0

    // Asset-specific sentiment
    const assetSentiment = new Map<string, { bull: number; bear: number; total: number }>()
    for (const item of items) {
      for (const asset of item.assets) {
        const existing = assetSentiment.get(asset) ?? { bull: 0, bear: 0, total: 0 }
        if (item.sentiment.label === 'bullish') existing.bull++
        else if (item.sentiment.label === 'bearish') existing.bear++
        existing.total++
        assetSentiment.set(asset, existing)
      }
    }

    const assetScores = Array.from(assetSentiment.entries())
      .map(([symbol, data]) => ({
        symbol,
        score: data.total > 0 ? (data.bull - data.bear) / data.total : 0,
        label: data.bull > data.bear ? 'bullish' : data.bear > data.bull ? 'bearish' : 'neutral',
        mentions: data.total,
      }))
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))

    return NextResponse.json({
      items: items.slice(0, limit),
      aggregate: {
        score: avgScore,
        label: avgScore > 0.1 ? 'bullish' : avgScore < -0.1 ? 'bearish' : 'neutral',
        bullCount,
        bearCount,
        neutralCount: items.length - bullCount - bearCount,
      },
      assetSentiment: assetScores,
      count: items.length,
    })
  } catch {
    return NextResponse.json({ items: [], aggregate: { score: 0, label: 'neutral' }, count: 0 })
  }
}
