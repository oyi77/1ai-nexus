// ─────────────────────────────────────────────────────────────
// IDX Alpha Engine — moon bagger signals.
//
// Combines 6 signals into a single alpha score (0-100):
//   1. Foreign Accumulation Velocity  (smart money flow)
//   2. Broker Concentration           (institutional accumulation)
//   3. Volume-Price Divergence        (accumulation before breakout)
//   4. Multi-timeframe Momentum       (trend alignment)
//   5. Fundamental Quality            (ROE/PER/PBV composite)
//   6. Value-Momentum Combo           (GARP: growth at reasonable price)
//
// Each signal returns { score: 0-100, weight, reasons[] }.
// Final score = weighted sum, normalized to 0-100.
// ─────────────────────────────────────────────────────────────

export interface AlphaInput {
  // Session data (last N days)
  sessions: Array<{
    date: string
    close: number
    volume: number
    value: number
    foreignBuy: number
    foreignSell: number
    high: number
    low: number
    open: number
  }>
  // Broker board (latest)
  brokers: Array<{ firm: string; value: number; volume: number }>
  // Screener snapshot
  screener: {
    per: number | null
    pbv: number | null
    roe: number | null
    der: number | null
    change1d: number | null
    change4w: number | null
    change13w: number | null
    change26w: number | null
    change52w: number | null
    marketCap: number | null
    price: number | null
    high52w: number | null
    low52w: number | null
  }
  // Universe stats (for z-score normalization)
  universeStats: {
    perMean: number
    perStd: number
    roeMean: number
    roeStd: number
    pbvMean: number
    pbvStd: number
  }
}

export interface SignalResult {
  score: number // 0-100
  weight: number
  reasons: Array<{ text: string; weight: number }>
}

export interface AlphaResult {
  totalScore: number // 0-100
  signals: {
    foreignVelocity: SignalResult
    brokerConcentration: SignalResult
    volumePriceDivergence: SignalResult
    multiTemporalMomentum: SignalResult
    fundamentalQuality: SignalResult
    valueMomentumCombo: SignalResult
  }
  verdict: 'strong-buy' | 'buy' | 'hold' | 'avoid'
  topReasons: string[]
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function z(value: number, mean: number, std: number): number {
  if (std === 0) return 0
  return (value - mean) / std
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// ── Signal 1: Foreign Accumulation Velocity ──
// Measures not just streak length but acceleration of foreign net-buy.
// Increasing net-buy volume = smart money piling in with conviction.
function signalForeignVelocity(input: AlphaInput): SignalResult {
  const { sessions } = input
  const reasons: Array<{ text: string; weight: number }> = []
  if (sessions.length < 3) return { score: 50, weight: 0.25, reasons: [] }

  const nets = sessions.map((s) => s.foreignBuy - s.foreignSell)
  const recentNets = nets.slice(-5) // last 5 sessions

  // Streak: consecutive same-direction days
  let streak = 0
  let dir: 'buy' | 'sell' | null = null
  for (let i = nets.length - 1; i >= 0; i--) {
    if (nets[i] === 0) break
    const cur: 'buy' | 'sell' = nets[i] > 0 ? 'buy' : 'sell'
    if (dir === null) dir = cur
    else if (cur !== dir) break
    streak++
  }

  // Acceleration: is net-buy increasing?
  let accel = 0
  if (recentNets.length >= 3) {
    const firstHalf = mean(recentNets.slice(0, Math.floor(recentNets.length / 2)))
    const secondHalf = mean(recentNets.slice(Math.floor(recentNets.length / 2)))
    accel = secondHalf - firstHalf
  }

  let score = 50
  if (dir === 'buy') {
    score += Math.min(streak * 5, 25) // streak bonus, capped
    if (accel > 0) {
      score += 15
      reasons.push({ text: `Foreign net-buy accelerating (${streak}d streak)`, weight: 0.4 })
    } else if (streak >= 3) {
      reasons.push({ text: `Foreign accumulation ${streak} sessions`, weight: 0.3 })
    }
    // Magnitude: net buy as % of total volume
    const totalVol = sessions.slice(-5).reduce((a, s) => a + s.volume, 0)
    const totalNet = recentNets.reduce((a, b) => a + b, 0)
    if (totalVol > 0) {
      const netPct = totalNet / totalVol
      if (netPct > 0.1) {
        score += 10
        reasons.push({ text: `${(netPct * 100).toFixed(0)}% of volume is foreign buy`, weight: 0.3 })
      }
    }
  } else if (dir === 'sell') {
    score -= Math.min(streak * 5, 25)
    if (streak >= 3) reasons.push({ text: `Foreign distribution ${streak} sessions`, weight: 0.3 })
  }

  return { score: clamp(score, 0, 100), weight: 0.25, reasons }
}

// ── Signal 2: Broker Concentration ──
// Top-3 brokers dominating turnover = institutional accumulation.
// Dispersed trading = retail noise.
function signalBrokerConcentration(input: AlphaInput): SignalResult {
  const { brokers } = input
  const reasons: Array<{ text: string; weight: number }> = []
  if (brokers.length < 3) return { score: 50, weight: 0.15, reasons: [] }

  const sorted = [...brokers].sort((a, b) => b.value - a.value)
  const totalValue = sorted.reduce((a, b) => a + b.value, 0)
  if (totalValue === 0) return { score: 50, weight: 0.15, reasons: [] }

  const top3Value = sorted.slice(0, 3).reduce((a, b) => a + b.value, 0)
  const top3Pct = top3Value / totalValue
  const top1Pct = sorted[0].value / totalValue

  let score = 50
  if (top3Pct > 0.5) {
    score += 20
    reasons.push({ text: `Top 3 brokers control ${(top3Pct * 100).toFixed(0)}% of turnover`, weight: 0.4 })
  } else if (top3Pct > 0.35) {
    score += 10
    reasons.push({ text: `Top 3 brokers = ${(top3Pct * 100).toFixed(0)}% of flow`, weight: 0.25 })
  }

  if (top1Pct > 0.2) {
    score += 15
    reasons.push({ text: `${sorted[0].firm} dominates with ${(top1Pct * 100).toFixed(0)}%`, weight: 0.35 })
  }

  return { score: clamp(score, 0, 100), weight: 0.15, reasons }
}

// ── Signal 3: Volume-Price Divergence ──
// Volume spiking while price flat/declining = accumulation before breakout.
// Classic smart-money pattern.
function signalVolumePriceDivergence(input: AlphaInput): SignalResult {
  const { sessions } = input
  const reasons: Array<{ text: string; weight: number }> = []
  if (sessions.length < 10) return { score: 50, weight: 0.2, reasons: [] }

  const recent = sessions.slice(-5)
  const prior = sessions.slice(-10, -5)

  const recentVol = mean(recent.map((s) => s.volume))
  const priorVol = mean(prior.map((s) => s.volume))
  const volRatio = priorVol > 0 ? recentVol / priorVol : 1

  const recentPriceChange = (recent[recent.length - 1].close - recent[0].close) / recent[0].close

  let score = 50
  // Volume spike + flat/down price = accumulation
  if (volRatio > 1.5 && recentPriceChange < 0.02) {
    score += 25
    reasons.push({ text: `Volume ${volRatio.toFixed(1)}x avg, price flat — accumulation`, weight: 0.5 })
  } else if (volRatio > 2 && recentPriceChange < 0.05) {
    score += 20
    reasons.push({ text: `Volume ${volRatio.toFixed(1)}x avg on weak price`, weight: 0.4 })
  } else if (volRatio > 1.2 && recentPriceChange > 0.03) {
    score += 10
    reasons.push({ text: `Volume + price rising together`, weight: 0.2 })
  } else if (volRatio < 0.7 && recentPriceChange > 0.05) {
    score -= 10
    reasons.push({ text: `Price rising on low volume — weak`, weight: 0.2 })
  }

  return { score: clamp(score, 0, 100), weight: 0.2, reasons }
}

// ── Signal 4: Multi-timeframe Momentum ──
// Aligned momentum across 4w/13w/26w/52w = strong trend = moon bagger.
function signalMultiTemporalMomentum(input: AlphaInput): SignalResult {
  const { screener } = input
  const reasons: Array<{ text: string; weight: number }> = []

  const changes = [screener.change4w, screener.change13w, screener.change26w, screener.change52w].filter(
    (c): c is number => c != null && Number.isFinite(c)
  )
  if (changes.length === 0) return { score: 50, weight: 0.15, reasons: [] }

  const positive = changes.filter((c) => c > 0).length
  const avgChange = mean(changes)

  let score = 50
  if (positive === changes.length && avgChange > 10) {
    score += 30
    reasons.push({ text: `Uptrend on all ${changes.length} timeframes`, weight: 0.5 })
  } else if (positive >= 3 && avgChange > 5) {
    score += 20
    reasons.push({ text: `${positive}/${changes.length} timeframes bullish`, weight: 0.35 })
  } else if (positive >= 2) {
    score += 5
  } else if (positive === 0) {
    score -= 20
    reasons.push({ text: `Downtrend on all timeframes`, weight: 0.3 })
  }

  // Distance from 52w high: room to run
  if (screener.price && screener.high52w && screener.high52w > 0) {
    const distFromHigh = (screener.high52w - screener.price) / screener.high52w
    if (distFromHigh < 0.1) {
      score += 10
      reasons.push({ text: `Near 52w high — breakout territory`, weight: 0.25 })
    } else if (distFromHigh > 0.5) {
      score -= 5
      reasons.push({ text: `${(distFromHigh * 100).toFixed(0)}% below 52w high`, weight: 0.15 })
    }
  }

  return { score: clamp(score, 0, 100), weight: 0.15, reasons }
}

// ── Signal 5: Fundamental Quality ──
// ROE/PER/PBV composite — the bedrock of multi-baggers.
function signalFundamentalQuality(input: AlphaInput): SignalResult {
  const { screener, universeStats } = input
  const reasons: Array<{ text: string; weight: number }> = []
  let score = 50

  // ROE z-score
  if (screener.roe != null) {
    const zRoe = z(screener.roe, universeStats.roeMean, universeStats.roeStd)
    score += zRoe * 12
    if (zRoe > 1) reasons.push({ text: `ROE ${screener.roe.toFixed(1)}% — top tier`, weight: 0.3 })
    else if (zRoe > 0.5) reasons.push({ text: `ROE ${screener.roe.toFixed(1)}% — above median`, weight: 0.2 })
    else if (screener.roe < 0) reasons.push({ text: `Negative ROE — loss-making`, weight: 0.3 })
  }

  // PER z-score (low = cheap = good)
  if (screener.per != null && screener.per > 0) {
    const zPer = z(screener.per, universeStats.perMean, universeStats.perStd)
    score += -zPer * 10
    if (zPer < -1) reasons.push({ text: `PER ${screener.per.toFixed(1)}x — deep value`, weight: 0.25 })
    else if (zPer < -0.5) reasons.push({ text: `PER ${screener.per.toFixed(1)}x — attractive`, weight: 0.15 })
  }

  // PBV z-score (low = undervalued)
  if (screener.pbv != null && screener.pbv > 0) {
    const zPbv = z(screener.pbv, universeStats.pbvMean, universeStats.pbvStd)
    score += -zPbv * 8
    if (zPbv < -1) reasons.push({ text: `PBV ${screener.pbv.toFixed(2)}x — below book`, weight: 0.2 })
  }

  // DER: low leverage bonus
  if (screener.der != null && screener.der > 0 && screener.der < 1) {
    score += 5
    reasons.push({ text: `DER ${screener.der.toFixed(2)} — healthy balance sheet`, weight: 0.1 })
  }

  return { score: clamp(score, 0, 100), weight: 0.1, reasons }
}

// ── Signal 6: Value-Momentum Combo (GARP) ──
// The classic moon bagger pattern: cheap fundamentals + positive momentum.
// Growth At a Reasonable Price.
function signalValueMomentumCombo(input: AlphaInput): SignalResult {
  const { screener, universeStats } = input
  const reasons: Array<{ text: string; weight: number }> = []
  let score = 50

  // Value component: low PER + low PBV
  let valueScore = 0
  if (screener.per != null && screener.per > 0) {
    const zPer = z(screener.per, universeStats.perMean, universeStats.perStd)
    valueScore += -zPer
  }
  if (screener.pbv != null && screener.pbv > 0) {
    const zPbv = z(screener.pbv, universeStats.pbvMean, universeStats.pbvStd)
    valueScore += -zPbv
  }

  // Momentum component: recent performance
  let momScore = 0
  if (screener.change4w != null) momScore += screener.change4w / 10
  if (screener.change13w != null) momScore += screener.change13w / 20

  // GARP: value + momentum aligned
  if (valueScore > 0.5 && momScore > 0) {
    score += 30
    reasons.push({ text: `GARP: undervalued + positive momentum`, weight: 0.5 })
  } else if (valueScore > 0.5) {
    score += 15
    reasons.push({ text: `Undervalued but no momentum yet`, weight: 0.3 })
  } else if (momScore > 0 && valueScore > -0.5) {
    score += 10
    reasons.push({ text: `Momentum with fair valuation`, weight: 0.2 })
  } else if (valueScore < -0.5 && momScore < 0) {
    score -= 15
    reasons.push({ text: `Expensive + falling — avoid`, weight: 0.3 })
  }

  return { score: clamp(score, 0, 100), weight: 0.05, reasons }
}

// ── Main: compute alpha score ──
export function computeAlpha(input: AlphaInput): AlphaResult {
  const foreignVelocity = signalForeignVelocity(input)
  const brokerConcentration = signalBrokerConcentration(input)
  const volumePriceDivergence = signalVolumePriceDivergence(input)
  const multiTemporalMomentum = signalMultiTemporalMomentum(input)
  const fundamentalQuality = signalFundamentalQuality(input)
  const valueMomentumCombo = signalValueMomentumCombo(input)

  const signals = { foreignVelocity, brokerConcentration, volumePriceDivergence, multiTemporalMomentum, fundamentalQuality, valueMomentumCombo }

  // Weighted sum
  let totalScore = 0
  let totalWeight = 0
  for (const [, s] of Object.entries(signals)) {
    totalScore += s.score * s.weight
    totalWeight += s.weight
  }
  totalScore = totalWeight > 0 ? totalScore / totalWeight : 50

  // Collect top reasons across all signals
  const allReasons = Object.values(signals).flatMap((s) => s.reasons)
  allReasons.sort((a, b) => b.weight - a.weight)
  const topReasons = allReasons.slice(0, 4).map((r) => r.text)

  // Verdict — tuned from the 3-month point-in-time track record
  // (5,049 evaluated signals, commit 19b2c69 era):
  //   60-62 → +1.63%/7d (no edge vs universe +1.66%) → cut
  //   62-68 → +1.8-2.1%/7d
  //   68-70 → +2.43%/7d, +9.62%/30d (best band)  → strong-buy floor
  //   75+   → +0.27%/7d, +4.70%/30d (extended chasers) → demoted
  let verdict: AlphaResult['verdict']
  if (totalScore >= 68 && totalScore < 75) verdict = 'strong-buy'
  else if (totalScore >= 62) verdict = 'buy'
  else if (totalScore >= 40) verdict = 'hold'
  else verdict = 'avoid'

  return { totalScore: Math.round(totalScore), signals, verdict, topReasons }
}
