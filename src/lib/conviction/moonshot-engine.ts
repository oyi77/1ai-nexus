// ─────────────────────────────────────────────────────────────
// Moonshot Engine — right-tail IDX runner selection.
//
// Separate lane from computeAlpha (steady-compounder blend). Tuned to
// P(MFE>=20%) measured on 4,185 track-record windows (27 signal dates):
//   momentum Q4-Q1 +13.4  → weight 0.35 (only tail-positive alpha signal)
//   volRatio>2 P20 37.8    → weight 0.30 (best single filter)
//   prox 0.70-0.90 P20 36.5→ weight 0.20 (pullback beats chase; >0.90 P20 28.1)
//   small<1T P20 37.2      → weight 0.10 (big>10T P20 20.4)
//   cyclicals P20 41.6     → weight 0.05 (sector tilt)
// Rejected: fundamentals (Q1 junk P20 44.9 beats Q4 22.7, spread -22.1),
// foreign velocity (-5.8), tight-base (tightest quartile P20 20.8 < rest 33.7).
// Combo prox>0.85 + tight + cap<10T measured P20 23.3 — anti-edge, not used.
// Pure functions; no I/O.
// ─────────────────────────────────────────────────────────────

export interface MoonshotInput {
  sessions: Array<{
    date: string
    close: number
    high: number
    low: number
    volume: number
  }>
  screener: {
    change4w: number | null
    change13w: number | null
    change26w: number | null
    change52w: number | null
    price: number | null
    high52w: number | null
    marketCap: number | null
  }
  sector: string
}

export interface MoonshotComponent {
  score: number // 0-100
  weight: number
  reasons: Array<{ text: string; weight: number }>
}

export interface MoonshotResult {
  totalScore: number // 0-100
  verdict: 'moonshot' | 'watch' | 'pass'
  topReasons: string[]
  components: {
    momentum: MoonshotComponent
    ignition: MoonshotComponent
    position: MoonshotComponent
    size: MoonshotComponent
    sector: MoonshotComponent
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// ── Momentum: multi-timeframe trend alignment (sole tail-positive signal) ──
function scoreMomentum(input: MoonshotInput): MoonshotComponent {
  const reasons: Array<{ text: string; weight: number }> = []
  const changes = [
    input.screener.change4w,
    input.screener.change13w,
    input.screener.change26w,
    input.screener.change52w,
  ].filter((c): c is number => c != null && Number.isFinite(c))
  if (changes.length === 0) return { score: 50, weight: 0.35, reasons }

  const positive = changes.filter((c) => c > 0).length
  const avg = mean(changes)
  let score = 50
  if (positive === changes.length && avg > 10) {
    score = 90
    reasons.push({ text: changes.length === 1 ? `Uptrend (short history)` : `Uptrend on all ${changes.length} timeframes`, weight: 0.35 })
  } else if (positive >= 3 && avg > 5) {
    score = 75
    reasons.push({ text: `${positive}/${changes.length} timeframes bullish`, weight: 0.3 })
  } else if (positive >= 2) {
    score = 60
  } else if (positive === 1) {
    score = 45
  } else {
    score = 25
    reasons.push({ text: changes.length === 1 ? `Downtrend (short history)` : `Downtrend on all timeframes`, weight: 0.3 })
  }
  return { score, weight: 0.35, reasons }
}

// ── Ignition: last-day volume vs prior-20 average + dead-flat guard ──
function scoreIgnition(input: MoonshotInput): MoonshotComponent {
  const reasons: Array<{ text: string; weight: number }> = []
  const { sessions } = input
  if (sessions.length < 6) return { score: 50, weight: 0.3, reasons }

  const last = sessions[sessions.length - 1]
  const prior = sessions.slice(Math.max(0, sessions.length - 21), sessions.length - 1)
  const priorAvg = mean(prior.map((s) => s.volume))
  const volRatio = priorAvg > 0 ? last.volume / priorAvg : 1

  let score = 50
  if (volRatio > 3) {
    score = 90
    reasons.push({ text: `Volume ${volRatio.toFixed(1)}x avg — ignition`, weight: 0.35 })
  } else if (volRatio > 2) {
    score = 80
    reasons.push({ text: `Volume ${volRatio.toFixed(1)}x avg — accumulation burst`, weight: 0.3 })
  } else if (volRatio > 1.5) {
    score = 65
    reasons.push({ text: `Volume ${volRatio.toFixed(1)}x avg — waking up`, weight: 0.2 })
  } else if (volRatio >= 1) {
    score = 55
  } else {
    score = 40
  }

  // Dead-flat guard: tightest-quartile cov measured P20 20.8 vs rest 33.7.
  // Scoped to dead trends (<1% per 10 sessions) — a +1.9% climber is ~47%/yr,
  // real energy even when session-to-session variance is low.
  const last10 = sessions.slice(-10).map((s) => s.close).filter((c) => c > 0)
  if (last10.length >= 6) {
    const m = mean(last10)
    const sd = Math.sqrt(mean(last10.map((c) => (c - m) ** 2)))
    const cov = m > 0 ? sd / m : NaN
    const trend = m > 0 ? (last10[last10.length - 1] - last10[0]) / last10[0] : NaN
    if (Number.isFinite(cov) && cov < 0.01 && (!Number.isFinite(trend) || trend < 0.01)) {
      score = clamp(score - 15, 0, 100)
      reasons.push({ text: `Flat base (cov ${cov.toFixed(4)}) — no energy`, weight: 0.25 })
    }
  }
  return { score: clamp(score, 0, 100), weight: 0.3, reasons }
}

// ── Position: pullback (0.70-0.90 of trailing high) beats chase ──
function scorePosition(input: MoonshotInput): MoonshotComponent {
  const reasons: Array<{ text: string; weight: number }> = []
  const { sessions, screener } = input
  const price = screener.price
  if (price == null || !(price > 0)) return { score: 50, weight: 0.2, reasons }

  let trailHigh = 0
  const window = sessions.slice(-250)
  for (const s of window) if (s.high > trailHigh) trailHigh = s.high
  if (!(trailHigh > 0) && screener.high52w && screener.high52w > 0) trailHigh = screener.high52w
  if (!(trailHigh > 0)) return { score: 50, weight: 0.2, reasons }

  const prox = price / trailHigh
  let score = 50
  if (prox >= 0.7 && prox <= 0.9) {
    score = 80
    reasons.push({ text: `${((1 - prox) * 100).toFixed(0)}% below high — pullback zone`, weight: 0.25 })
  } else if (prox >= 0.6 && prox < 0.7) {
    score = 65
    reasons.push({ text: `Deep pullback — higher risk/reward`, weight: 0.2 })
  } else if (prox > 0.9 && prox <= 0.95) {
    score = 55
  } else if (prox > 0.95) {
    score = 40
    reasons.push({ text: `At the high — chasing`, weight: 0.2 })
  } else {
    score = 50
    reasons.push({ text: `Far from high — basing or broken`, weight: 0.15 })
  }
  return { score, weight: 0.2, reasons }
}

// ── Size: only small/mid caps multi-bag ──
function scoreSize(input: MoonshotInput): MoonshotComponent {
  const reasons: Array<{ text: string; weight: number }> = []
  const cap = input.screener.marketCap
  if (cap == null || !(cap > 0)) return { score: 50, weight: 0.1, reasons }
  if (cap < 1e12) {
    reasons.push({ text: `Small cap — runner capacity`, weight: 0.15 })
    return { score: 80, weight: 0.1, reasons }
  }
  if (cap < 1e13) return { score: 65, weight: 0.1, reasons }
  reasons.push({ text: `Big cap — capped upside`, weight: 0.15 })
  return { score: 30, weight: 0.1, reasons }
}

// ── Sector: runners come in waves ──
const SECTOR_TILT: Record<string, number> = {
  'Consumer Cyclicals': 75,
  'Transportation & Logistic': 70,
  'Transportation & Logistics': 70,
  'Basic Materials': 65,
  Energy: 60,
  'Properties & Real Estate': 60,
  Infrastructures: 60,
  Industrials: 55,
  Technology: 50,
  'Consumer Non-Cyclicals': 45,
  Financials: 35,
  Healthcare: 35,
}

function scoreSector(input: MoonshotInput): MoonshotComponent {
  const reasons: Array<{ text: string; weight: number }> = []
  const score = SECTOR_TILT[input.sector] ?? 50
  if (score >= 65) reasons.push({ text: `${input.sector} — hot sector`, weight: 0.1 })
  else if (score <= 35) reasons.push({ text: `${input.sector} — cold sector`, weight: 0.1 })
  return { score, weight: 0.05, reasons }
}

// ── Main ──
export function computeMoonshot(input: MoonshotInput): MoonshotResult {
  if (input.sessions.length === 0) {
    const neutral: MoonshotComponent = { score: 50, weight: 0, reasons: [] }
    return {
      totalScore: 50,
      verdict: 'pass',
      topReasons: ['No session history — moonshot unavailable.'],
      components: {
        momentum: { ...neutral, weight: 0.35 },
        ignition: { ...neutral, weight: 0.3 },
        position: { ...neutral, weight: 0.2 },
        size: { ...neutral, weight: 0.1 },
        sector: { ...neutral, weight: 0.05 },
      },
    }
  }

  const momentum = scoreMomentum(input)
  const ignition = scoreIgnition(input)
  const position = scorePosition(input)
  const size = scoreSize(input)
  const sector = scoreSector(input)
  const components = { momentum, ignition, position, size, sector }

  let total = 0
  let weight = 0
  for (const c of Object.values(components)) {
    total += c.score * c.weight
    weight += c.weight
  }
  total = weight > 0 ? total / weight : 50

  const allReasons = Object.values(components).flatMap((c) => c.reasons)
  allReasons.sort((a, b) => b.weight - a.weight)
  const topReasons = allReasons.slice(0, 4).map((r) => r.text)

  let verdict: MoonshotResult['verdict']
  // Thresholds from moonshot-lane backfill (13,320 rows, 2026-09-14):
  //   70-72 → P20 42.6 / P30 26.3 (n=2,061) — diluted
  //   78+   → P20 49.3 / P30 31.6 (n=1,110) — conviction band
  // Universe baseline P20 33.4 / P30 19.1.
  if (total >= 78) verdict = 'moonshot'
  else if (total >= 60) verdict = 'watch'
  else verdict = 'pass'

  return { totalScore: Math.round(total), verdict, topReasons, components }
}
