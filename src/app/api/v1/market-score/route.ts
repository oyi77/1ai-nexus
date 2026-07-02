// ─────────────────────────────────────────────────────────────
// GET /api/v1/market-score — Market-Moving Score
// ?symbol=BTC&market=crypto_cex
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { computeMarketMovingScore, computeBatchScores } from '@/lib/modules/derived/market-moving-score'
import type { MarketVertical } from '@/lib/modules/market/types'

const TOP_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'ARB', 'OP', 'ADA']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol') ?? undefined
  const market = (searchParams.get('market') ?? 'crypto_cex') as MarketVertical

  try {
    if (symbol) {
      // Single symbol
      const score = await computeMarketMovingScore(symbol.toUpperCase(), market)
      return apiJson({ score })
    }

    // Batch: top symbols
    const scores = await computeBatchScores(TOP_SYMBOLS, market)
    return apiJson({ scores, count: scores.length, market })

  } catch (err) {
    console.error('Market score error:', err)
    return apiError('Failed to compute market score', 502)
  }
}
