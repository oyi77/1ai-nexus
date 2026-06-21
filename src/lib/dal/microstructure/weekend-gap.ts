// ─────────────────────────────────────────────────────────────
// Weekend Gap Risk — crypto vs equity weekend drift
// Tier 0: public APIs (Binance, Yahoo Finance proxy)
// §4.3 — detect structural weekend dislocations
// ─────────────────────────────────────────────────────────────


interface WeekendSnapshot {
  fridayClose: number
  mondayOpen: number
  gapPct: number
  capturedAt: number
}

interface DriftCorrelation {
  symbol: string
  cryptoWeekendDriftPct: number
  equityWeekendDriftPct: number
  correlation: number // -1..1 approximation
  sampleCount: number
  lastComputed: number
}

export interface WeekendGap {
  symbol: string
  fridayClose: number
  mondayOpen: number
  gapPct: number
  zScore: number
  alert: boolean
  timestamp: number
}

// In-memory storage — weekend snapshots keyed by symbol
const WEEKEND_SNAPS: Map<string, WeekendSnapshot[]> = new Map()
const MAX_WEEKEND_SAMPLES = 12 // ~3 months of weekends
const ALERT_THRESHOLD_ZSCORE = 2

// Reference equity indices for drift correlation
const EQUITY_ETFS = ['SPY', 'QQQ']

function pushSnapshot(symbol: string, snap: WeekendSnapshot) {
  if (!WEEKEND_SNAPS.has(symbol)) WEEKEND_SNAPS.set(symbol, [])
  const arr = WEEKEND_SNAPS.get(symbol)!
  arr.push(snap)
  if (arr.length > MAX_WEEKEND_SAMPLES) arr.splice(0, arr.length - MAX_WEEKEND_SAMPLES)
}

function calcZScore(values: number[], current: number): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const stdDev = Math.sqrt(variance)
  if (stdDev < 0.0001) return 0
  return (current - mean) / stdDev
}

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/**
 * Fetch the most recent Friday-to-Monday gap for a crypto symbol.
 * Uses Binance klines to find Friday close and Monday open.
 */
export async function getWeekendGap(symbol = 'BTCUSDT'): Promise<WeekendGap | null> {
  const now = new Date()
  const dayOfWeek = now.getUTCDay() // 0=Sun, 5=Fri

  // Calculate the most recent Friday (day 5) 23:59 UTC
  const daysSinceFriday = dayOfWeek >= 5 ? dayOfWeek - 5 : dayOfWeek + 2
  const fridayEnd = new Date(now)
  fridayEnd.setUTCDate(fridayEnd.getUTCDate() - daysSinceFriday)
  fridayEnd.setUTCHours(23, 59, 59, 999)

  // Monday open = Friday end + 2 days
  const mondayStart = new Date(fridayEnd)
  mondayStart.setUTCDate(mondayStart.getUTCDate() + 2)
  mondayStart.setUTCHours(0, 0, 0, 0)

  const fridayStartMs = fridayEnd.getTime() - 4 * 60 * 60 * 1000 // 4h window before Friday end
  const mondayEndMs = mondayStart.getTime() + 4 * 60 * 60 * 1000

  try {
    // Fetch 4h candles covering Friday close and Monday open
    const klineUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${fridayStartMs}&endTime=${mondayEndMs}&limit=12`
    const klines = await fetchJson<Array<[number, string, string, string, string, string]>>(klineUrl)

    if (klines.length < 2) return null

    // Find the last candle before weekend (Friday) and first after (Sunday/Monday)
    const weekendBoundary = fridayEnd.getTime()
    let fridayClose = 0
    let mondayOpen = 0

    for (const k of klines) {
      const openTime = k[0]
      if (openTime <= weekendBoundary) {
        fridayClose = Number(k[4]) // close price
      }
      if (openTime >= weekendBoundary && mondayOpen === 0) {
        mondayOpen = Number(k[1]) // open price
      }
    }

    if (!fridayClose || !mondayOpen) return null

    const gapPct = ((mondayOpen - fridayClose) / fridayClose) * 100
    pushSnapshot(symbol, { fridayClose, mondayOpen, gapPct, capturedAt: Date.now() })

    const history = WEEKEND_SNAPS.get(symbol) || []
    const gaps = history.map(s => s.gapPct)
    const zScore = calcZScore(gaps, gapPct)

    return {
      symbol,
      fridayClose,
      mondayOpen,
      gapPct,
      zScore,
      alert: Math.abs(zScore) > ALERT_THRESHOLD_ZSCORE,
      timestamp: Date.now(),
    }
  } catch {
    return null
  }
}

/**
 * Calculate weekend drift correlation between crypto and equity.
 * Compares recent weekend gaps for crypto against equity ETF gaps.
 * Returns correlation in [-1, 1] range.
 */
export async function getWeekendDriftCorrelation(): Promise<DriftCorrelation[]> {
  const results: DriftCorrelation[] = []
  const cryptoSymbols = ['BTCUSDT', 'ETHUSDT']

  // Gather crypto weekend gaps
  const cryptoGaps = new Map<string, number[]>()
  for (const sym of cryptoSymbols) {
    const gap = await getWeekendGap(sym)
    if (gap) {
      const history = WEEKEND_SNAPS.get(sym) || []
      cryptoGaps.set(sym, history.map(s => s.gapPct))
    }
  }

  // Fetch equity data for SPY/QQQ via Yahoo Finance (free JSON endpoint)
  for (const etf of EQUITY_ETFS) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${etf}?interval=1d&range=3mo`
      const data = await fetchJson<{ chart: { result: Array<{ timestamp: number[]; indicators: { quote: Array<{ close: number[] }> } }> } }>(url)
      const result = data.chart?.result?.[0]
      if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) continue

      const timestamps = result.timestamp
      const closes = result.indicators.quote[0].close
      const equityGaps: number[] = []

      for (let i = 1; i < timestamps.length; i++) {
        const prevDay = new Date(timestamps[i - 1] * 1000)
        const currDay = new Date(timestamps[i] * 1000)
        // Detect Monday (day 1) after Friday (day 5)
        if (currDay.getUTCDay() === 1 && prevDay.getUTCDay() === 5) {
          const prevClose = closes[i - 1]
          const currOpen = closes[i] // daily close acts as proxy for open
          if (prevClose && currOpen) {
            equityGaps.push(((currOpen - prevClose) / prevClose) * 100)
          }
        }
      }

      // Correlate with each crypto
      for (const [sym, cryptoGapValues] of cryptoGaps) {
        const n = Math.min(cryptoGapValues.length, equityGaps.length)
        if (n < 2) {
          results.push({
            symbol: sym,
            cryptoWeekendDriftPct: 0,
            equityWeekendDriftPct: 0,
            correlation: 0,
            sampleCount: n,
            lastComputed: Date.now(),
          })
          continue
        }

        const c = cryptoGapValues.slice(-n)
        const e = equityGaps.slice(-n)

        const meanC = c.reduce((s, v) => s + v, 0) / n
        const meanE = e.reduce((s, v) => s + v, 0) / n

        let cov = 0
        let varC = 0
        let varE = 0
        for (let i = 0; i < n; i++) {
          const dc = c[i] - meanC
          const de = e[i] - meanE
          cov += dc * de
          varC += dc * dc
          varE += de * de
        }

        const denom = Math.sqrt(varC * varE)
        const correlation = denom > 0 ? cov / denom : 0

        results.push({
          symbol: sym,
          cryptoWeekendDriftPct: meanC,
          equityWeekendDriftPct: meanE,
          correlation,
          sampleCount: n,
          lastComputed: Date.now(),
        })
      }
    } catch {
      // Yahoo Finance may rate-limit — skip silently
    }
  }

  return results
}
