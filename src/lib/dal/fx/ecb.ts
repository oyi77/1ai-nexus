// ─────────────────────────────────────────────────────────────
// FX Rates — shared utility for cross-border calculations
// Tier 0: ECB daily reference rates (free, official)
// Tier 0: exchangerate.host (free aggregator, cross-check)
// §1.5 — build once, used by kimchi premium, ETF NAV, gaps
// ─────────────────────────────────────────────────────────────

const ECB_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A'
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

let cachedRates: Map<string, number> | null = null
let cacheTimestamp = 0

interface EcbResponse {
  dataSets: Array<{ observations: Record<string, Array<[number]> > }>
  structure: { dimensions: { series: Array<{ values: Array<{ id: string }> }> } }
}

/**
 * Get EUR-based FX rates from ECB. Returns a map of CURRENCY→EUR rate.
 * Cached for 1 hour.
 */
export async function getEcbRates(): Promise<Map<string, number>> {
  const now = Date.now()
  if (cachedRates && now - cacheTimestamp < CACHE_TTL) {
    return cachedRates
  }

  try {
    const res = await fetch(`${ECB_URL}?format=JSONdata&lastNObservations=1`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`ECB ${res.status}`)

    const data = await res.json() as EcbResponse
    const rates = new Map<string, number>()
    const currencies = data.structure?.dimensions?.series?.[0]?.values || []

    for (let i = 0; i < currencies.length; i++) {
      const currency = currencies[i]?.id
      const obs = data.dataSets?.[0]?.observations?.[String(i)]
      const value = Array.isArray(obs) ? obs[0] : obs
      if (currency && typeof value === 'number') {
        rates.set(currency, value)
      }
    }

    cachedRates = rates
    cacheTimestamp = now
    return rates
  } catch {
    return cachedRates || new Map()
  }
}

/**
 * Convert amount from one currency to another using ECB rates.
 */
export async function convertFx(amount: number, from: string, to: string): Promise<number> {
  if (from === to) return amount
  const rates = await getEcbRates()

  // ECB rates are EUR-based: EUR→X rate
  const fromRate = rates.get(from)
  const toRate = rates.get(to)

  if (from === 'EUR' && toRate) return amount * toRate
  if (to === 'EUR' && fromRate) return amount / fromRate
  if (fromRate && toRate) return (amount / fromRate) * toRate

  // Fallback: try direct pair
  return amount // Can't convert — return as-is
}

/**
 * Get KRW/USD rate for kimchi premium calculation.
 */
export async function getKrwUsdRate(): Promise<number> {
  const rates = await getEcbRates()
  const krwToEur = rates.get('KRW')
  const usdToEur = rates.get('USD')
  if (krwToEur && usdToEur) {
    return usdToEur / krwToEur // KRW per USD
  }
  return 0
}
