// ─────────────────────────────────────────────────────────────
// GET /api/v1/signals/outcomes — Signal outcome tracking
// ?action=check|summary|list&limit=100
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { checkExpiredSignals, getSignalOutcomesSummary, getBacktestResults, getPendingSignalsCount } from '@/lib/modules/derived/backtest-engine'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'summary'
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50') || 50))

  try {
    // Check and update expired signals
    if (action === 'check') {
      const result = await checkExpiredSignals()
      return apiJson(result)
    }

    // Get signal outcomes list
    if (action === 'list') {
      const results = await getBacktestResults(undefined, undefined, limit)
      const pendingCount = await getPendingSignalsCount()
      return apiJson({ results, pendingCount, count: results.length })
    }

    // Default: summary
    const summary = await getSignalOutcomesSummary()
    return apiJson(summary)

  } catch (err) {
    console.error('Signal outcomes error:', err)
    return apiError('Failed to get signal outcomes', 502)
  }
}
