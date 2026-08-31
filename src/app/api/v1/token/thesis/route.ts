import { apiJson, apiError } from '@/lib/api/response'
import { fetchAlphaSignals } from '@/lib/modules/derived/alpha-feed'

export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────
// GET /api/v1/token/thesis?symbol=BTC
// Aggregates alpha signals for a token into a trade thesis.
// ─────────────────────────────────────────────────────────────

const DIRECTION_WEIGHT: Record<string, number> = {
  bullish: 1,
  bearish: -1,
  neutral: 0,
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  if (!symbol) {
    return apiError('symbol is required', 400)
  }
  const target = symbol.toUpperCase()

  try {
    const signals = await fetchAlphaSignals(100)
    const matched = signals.filter(s => s.asset.toUpperCase() === target)

    let bullish = 0
    let bearish = 0
    let neutral = 0
    let weightedScore = 0
    let confidenceSum = 0

    for (const s of matched) {
      if (s.direction === 'bullish') bullish++
      else if (s.direction === 'bearish') bearish++
      else neutral++
      weightedScore += (DIRECTION_WEIGHT[s.direction] ?? 0) * s.strength * s.confidence
      confidenceSum += s.confidence
    }

    const thesis = weightedScore > 0 ? 'BULLISH' : weightedScore < 0 ? 'BEARISH' : 'NEUTRAL'
    const confidence = matched.length > 0 ? confidenceSum / matched.length : 0
    const topSignals = [...matched]
      .sort((a, b) => b.strength * b.confidence - a.strength * a.confidence)
      .slice(0, 5)

    return apiJson({
      symbol: target,
      thesis,
      weightedScore,
      confidence,
      counts: { bullish, bearish, neutral },
      totalSignals: matched.length,
      topSignals,
    })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
