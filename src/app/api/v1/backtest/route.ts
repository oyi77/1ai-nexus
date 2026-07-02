// ─────────────────────────────────────────────────────────────
// GET /api/v1/backtest — Backtest historical signals
// ?action=store-signal|run|stats|results&period=30&symbol=BTC
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { runBacktest, getBacktestResults, getBacktestStats, storeSignal } from '@/lib/modules/derived/backtest-engine'
import { getAlphaSignals } from '@/lib/modules/derived/alpha-engine'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol') ?? undefined
  const period = Math.min(90, Math.max(7, parseInt(searchParams.get('period') ?? '30') || 30))
  const action = searchParams.get('action') ?? 'stats'

  try {
    // Store current signals for future backtesting
    if (action === 'store-signal') {
      const { signals } = await getAlphaSignals()
      let stored = 0

      for (const s of signals) {
        if (!s.entry || !s.sl || s.direction === 'neutral') continue
        await storeSignal({
          id: s.id,
          symbol: s.symbol,
          direction: s.direction,
          entry: s.entry,
          tp1: s.tp1,
          tp2: s.tp2,
          tp3: s.tp3,
          sl: s.sl,
          timestamp: s.timestamp,
          source: s.sources[0] ?? 'unknown',
        })
        stored++
      }

      return apiJson({ stored, total: signals.length })
    }

    // Run backtest on stored historical signals
    if (action === 'run') {
      const { results, stats } = await runBacktest(period)
      return apiJson({ stats, results: results.slice(0, 50), period })
    }

    // Get completed backtest results
    if (action === 'results') {
      const results = await getBacktestResults(symbol, period, 100)
      return apiJson({ results, count: results.length })
    }

    // Default: stats from completed backtests
    const stats = await getBacktestStats(symbol, period)
    return apiJson({ stats, symbol, period })

  } catch (err) {
    console.error('Backtest error:', err)
    return apiError('Failed to run backtest', 502)
  }
}
