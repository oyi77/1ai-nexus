import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// Premium & Basis Monitor Module
// Coinbase Premium, Korea Premium, Futures Basis
// All free public exchange APIs, zero keys
// ─────────────────────────────────────────────────────────────

export interface PremiumSnapshot {
  venuePair: string
  asset: string
  premiumPct: number
  timestamp: string
  description: string
}

// ─── Coinbase Premium ──────────────────────────────────────

async function fetchCoinbasePremium(): Promise<PremiumSnapshot | null> {
  try {
    const [cbRes, bnRes] = await Promise.all([
      fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal: AbortSignal.timeout(8_000) }),
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(8_000) }),
    ])

    if (!cbRes.ok || !bnRes.ok) return null

    const cbData = await cbRes.json() as { data?: { amount?: string } }
    const bnData = await bnRes.json() as { price?: string }

    const cbPrice = parseFloat(cbData.data?.amount ?? '0')
    const bnPrice = parseFloat(bnData.price ?? '0')

    if (cbPrice <= 0 || bnPrice <= 0) return null

    const premium = ((cbPrice - bnPrice) / bnPrice) * 100

    return {
      venuePair: 'Coinbase vs Binance',
      asset: 'BTC',
      premiumPct: premium,
      timestamp: new Date().toISOString(),
      description: `Coinbase premium: ${premium >= 0 ? '+' : ''}${premium.toFixed(2)}% — ${premium > 0.5 ? 'US institutional buying' : premium < -0.5 ? 'US institutional selling' : 'neutral'}`,
    }
  } catch { return null }
}

// ─── Korea Premium (Kimchi) ────────────────────────────────

async function fetchKoreaPremium(): Promise<PremiumSnapshot | null> {
  try {
    const [upbitRes, binanceRes] = await Promise.all([
      fetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC', { signal: AbortSignal.timeout(8_000) }),
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(8_000) }),
      fetch('https://open.er-api.com/v6/latest/KRW', { signal: AbortSignal.timeout(8_000) }),
    ])

    if (!upbitRes.ok || !binanceRes.ok) return null

    const upbitData = await upbitRes.json() as Array<{ trade_price?: number }>
    const bnData = await binanceRes.json() as { price?: string }
    const fxRes = await fetch('https://open.er-api.com/v6/latest/KRW', { signal: AbortSignal.timeout(8_000) })
    const fxData = await fxRes.json() as { rates?: { USD?: number } }

    const upbitKRW = upbitData[0]?.trade_price ?? 0
    const bnUSD = parseFloat(bnData.price ?? '0')
    const krwPerUSD = fxData.rates?.USD ? 1 / fxData.rates.USD : 0

    if (upbitKRW <= 0 || bnUSD <= 0 || krwPerUSD <= 0) return null

    const upbitUSD = upbitKRW * krwPerUSD
    const premium = ((upbitUSD - bnUSD) / bnUSD) * 100

    return {
      venuePair: 'Upbit vs Binance',
      asset: 'BTC',
      premiumPct: premium,
      timestamp: new Date().toISOString(),
      description: `Korea premium: ${premium >= 0 ? '+' : ''}${premium.toFixed(2)}% — ${premium > 2 ? 'strong Korean demand' : premium < -2 ? 'Korean selling pressure' : 'neutral'}`,
    }
  } catch { return null }
}

// ─── Futures Basis ─────────────────────────────────────────

async function fetchFuturesBasis(): Promise<PremiumSnapshot | null> {
  try {
    const [spotRes, futuresRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(8_000) }),
      fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(8_000) }),
    ])

    if (!spotRes.ok || !futuresRes.ok) return null

    const spotData = await spotRes.json() as { price?: string }
    const futuresData = await futuresRes.json() as { price?: string }

    const spot = parseFloat(spotData.price ?? '0')
    const futures = parseFloat(futuresData.price ?? '0')

    if (spot <= 0 || futures <= 0) return null

    const basis = ((futures - spot) / spot) * 100

    return {
      venuePair: 'BTC Futures vs Spot',
      asset: 'BTC',
      premiumPct: basis,
      timestamp: new Date().toISOString(),
      description: `Futures basis: ${basis >= 0 ? '+' : ''}${basis.toFixed(3)}% — ${basis > 0.1 ? 'contango (bullish leverage)' : basis < -0.1 ? 'backwardation (bearish)' : 'neutral'}`,
    }
  } catch { return null }
}

// ─── Aggregate ─────────────────────────────────────────────

export async function fetchPremiumSnapshots(): Promise<PremiumSnapshot[]> {
  const [coinbase, korea, basis] = await Promise.allSettled([
    fetchCoinbasePremium(),
    fetchKoreaPremium(),
    fetchFuturesBasis(),
  ])

  const results: PremiumSnapshot[] = []
  if (coinbase.status === 'fulfilled' && coinbase.value) results.push(coinbase.value)
  if (korea.status === 'fulfilled' && korea.value) results.push(korea.value)
  if (basis.status === 'fulfilled' && basis.value) results.push(basis.value)

  return results
}

export async function persistPremiumSnapshots(snapshots: PremiumSnapshot[]): Promise<number> {
  let persisted = 0
  for (const snap of snapshots) {
    try {
      await prisma.premiumSnapshot.create({
        data: {
          venuePair: snap.venuePair,
          asset: snap.asset,
          premiumPct: snap.premiumPct,
        },
      })
      persisted++
    } catch { /* skip duplicates */ }
  }
  return persisted
}
