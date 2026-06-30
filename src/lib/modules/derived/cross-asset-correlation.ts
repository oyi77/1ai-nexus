// ─────────────────────────────────────────────────────────────
// Cross-Asset Correlation Engine — THE differentiator
// No competitor correlates TradFi + on-chain + weather + news
// §1.6 — connects on-chain signals to traditional market gaps
// ─────────────────────────────────────────────────────────────

export interface CorrelationResult {
  pair: string
  assetA: string
  assetB: string
  correlation: number // -1 to 1
  pValue: number
  sampleSize: number
  lag: number // days
  significance: 'strong' | 'moderate' | 'weak' | 'none'
  description: string
}

interface TimeSeriesPoint {
  date: string
  value: number
}

// In-memory correlation cache
const correlationCache = new Map<string, CorrelationResult>()
let lastCalculation = 0
const CALC_INTERVAL = 60 * 60 * 1000 // 1 hour

function pearson(x: number[], y: number[]): { r: number; pValue: number } {
  const n = Math.min(x.length, y.length)
  if (n < 3) return { r: 0, pValue: 1 }

  const xSlice = x.slice(0, n)
  const ySlice = y.slice(0, n)

  const xMean = xSlice.reduce((s, v) => s + v, 0) / n
  const yMean = ySlice.reduce((s, v) => s + v, 0) / n

  let covXY = 0, varX = 0, varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - xMean
    const dy = ySlice[i] - yMean
    covXY += dx * dy
    varX += dx * dx
    varY += dy * dy
  }

  const denom = Math.sqrt(varX * varY)
  const r = denom === 0 ? 0 : covXY / denom

  const t = denom === 0 ? 0 : r * Math.sqrt((n - 2) / (1 - r * r))
  const pValue = 1 - tDistCDF(Math.abs(t), n - 2)

  return { r, pValue: Math.min(1, Math.max(0, pValue)) }
}

function tDistCDF(t: number, df: number): number {
  const x = df / (df + t * t)
  return 1 - 0.5 * incompleteBeta(df / 2, 0.5, x)
}

function incompleteBeta(a: number, b: number, x: number): number {
  const beta = Math.exp(gamma(a) + gamma(b) - gamma(a + b))
  const maxIter = 200
  let sum = 0, term = 1
  for (let n = 0; n < maxIter; n++) {
    if (n > 0) term *= x * (1 + (b - 1 + n) / (a + n))
    sum += term / (n + 1) / beta
  }
  return Math.pow(x, a) * Math.pow(1 - x, b) * sum / a
}

function gamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - gamma(1 - z)
  z -= 1
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

export function calculateCrossCorrelation(
  seriesA: TimeSeriesPoint[],
  seriesB: TimeSeriesPoint[],
  lagDays = 0,
): CorrelationResult {
  const alignedA: number[] = []
  const alignedB: number[] = []

  const indexB = new Map(seriesB.map((p, i) => [p.date, i]))

  for (const pointA of seriesA) {
    const date = new Date(pointA.date)
    date.setDate(date.getDate() + lagDays)
    const lagDate = date.toISOString().slice(0, 10)
    const index = indexB.get(lagDate)
    if (index !== undefined) {
      alignedA.push(pointA.value)
      alignedB.push(seriesB[index].value)
    }
  }

  const { r, pValue } = pearson(alignedA, alignedB)

  return {
    pair: `${seriesA[0]?.date || 'A'} vs ${seriesB[0]?.date || 'B'}`,
    assetA: 'A',
    assetB: 'B',
    correlation: Math.round(r * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    sampleSize: alignedA.length,
    lag: lagDays,
    significance: significance(r),
    description: '',
  }
}

function significance(r: number): CorrelationResult['significance'] {
  const absR = Math.abs(r)
  if (absR >= 0.7) return 'strong'
  if (absR >= 0.4) return 'moderate'
  if (absR >= 0.15) return 'weak'
  return 'none'
}

interface ChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: { quote?: Array<{ close?: number[] }> }
    }>
  }
}

async function fetchYahooReturns(symbol: string, days = 30): Promise<number[]> {
  try {
    const registry = await import('@/lib/modules').then(m => m.registerAllModules())
    const result = await registry.fetchOne('yahoo-finance', { symbol, action: 'chart', interval: '1d', range: '1mo' })
    const chart = result?.data as { quote?: { close?: number[] } } | null
    const closes = chart?.quote?.close ?? []
    const validCloses = closes.filter((c): c is number => c != null && c > 0)
    const returns: number[] = []
    for (let i = 1; i < validCloses.length; i++) {
      if (validCloses[i - 1] > 0) {
        returns.push((validCloses[i] - validCloses[i - 1]) / validCloses[i - 1])
      }
    }
    return returns.slice(-days)
  } catch {
    return []
  }
}

interface FearGreedHistoryResponse {
  data?: Array<{ value: string; timestamp: string }>
}

async function fetchFearGreedReturns(days = 30): Promise<number[]> {
  try {
    const res = await fetch(`https://api.alternative.me/fng/?limit=${days}&format=json`, { signal: AbortSignal.timeout(10_000) })
    const json = await res.json() as FearGreedHistoryResponse
    const values = (json.data ?? []).map(d => parseInt(d.value, 10)).reverse()
    const returns: number[] = []
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] > 0) {
        returns.push((values[i] - values[i - 1]) / values[i - 1])
      }
    }
    return returns
  } catch {
    return []
  }
}

function computePairCorrelation(
  returnsA: number[],
  returnsB: number[],
  pair: string,
  assetA: string,
  assetB: string,
): CorrelationResult | null {
  if (returnsA.length < 5 || returnsB.length < 5) return null
  const { r, pValue } = pearson(returnsA, returnsB)
  return {
    pair,
    assetA,
    assetB,
    correlation: Math.round(r * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    sampleSize: Math.min(returnsA.length, returnsB.length),
    lag: 0,
    significance: significance(r),
    description: `${assetA}/${assetB} rolling ${Math.min(returnsA.length, returnsB.length)}d Pearson r=${r.toFixed(3)}, p=${pValue.toFixed(4)}`,
  }
}

/**
 * Fetch and calculate all cross-asset correlations from real historical data.
 * Uses 30-day rolling Pearson correlation on daily returns.
 */
export async function calculateAllCorrelations(): Promise<CorrelationResult[]> {
  const now = Date.now()
  if (correlationCache.size > 0 && now - lastCalculation < CALC_INTERVAL) {
    return Array.from(correlationCache.values())
  }

  const results: CorrelationResult[] = []

  try {
    // Fetch 30-day daily returns for all assets in parallel
    const [btcReturns, ethReturns, solReturns, spxReturns, goldReturns, fgiReturns] = await Promise.all([
      fetchYahooReturns('BTC-USD'),
      fetchYahooReturns('ETH-USD'),
      fetchYahooReturns('SOL-USD'),
      fetchYahooReturns('^GSPC'),
      fetchYahooReturns('GC=F'),
      fetchFearGreedReturns(),
    ])

    // Compute real Pearson correlations from daily returns
    const pairs: Array<[string, string, string, number[], number[]]> = [
      ['BTC/ETH', 'BTC', 'ETH', btcReturns, ethReturns],
      ['BTC/SOL', 'BTC', 'SOL', btcReturns, solReturns],
      ['ETH/SOL', 'ETH', 'SOL', ethReturns, solReturns],
      ['S&P 500/BTC', 'S&P 500', 'BTC', spxReturns, btcReturns],
      ['Gold/BTC', 'Gold', 'BTC', goldReturns, btcReturns],
      ['FGI vs BTC', 'Fear & Greed Index', 'BTC', fgiReturns, btcReturns],
    ]

    for (const [pair, assetA, assetB, returnsA, returnsB] of pairs) {
      const result = computePairCorrelation(returnsA, returnsB, pair, assetA, assetB)
      if (result) results.push(result)
    }

    // Funding rate correlation (requires Binance data)
    try {
      const registry = await import('@/lib/modules').then(m => m.registerAllModules())
      const derivRes = await registry.fetchOne('binance-futures', { limit: 10 })
      const pairs = (derivRes?.data as Record<string, unknown> | undefined)?.topPairs as { fundingRate?: number }[] | undefined
      if (pairs && pairs.length > 0) {
        const avgFunding = pairs.reduce((s, p) => s + (p.fundingRate || 0), 0) / pairs.length
        // We only have current snapshot, not historical — report honestly
        results.push({
          pair: 'Funding Rate vs Price',
          assetA: 'Avg Funding Rate',
          assetB: 'BTC Price',
          correlation: 0,
          pValue: 1,
          sampleSize: 1,
          lag: 0,
          significance: 'none',
          description: `Snapshot only: avg funding ${(avgFunding * 100).toFixed(4)}% — ${avgFunding > 0.001 ? 'high long leverage, reversal risk' : 'neutral leverage'}. Historical correlation requires time-series data.`,
        })
      }
    } catch { /* optional */ }

    for (const r of results) {
      correlationCache.set(r.pair, r)
    }
    lastCalculation = now
  } catch {
    // Return cached results
  }

  return results
}

export function getCachedCorrelations(): CorrelationResult[] {
  return Array.from(correlationCache.values())
}
