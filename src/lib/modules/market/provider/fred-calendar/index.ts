// ─────────────────────────────────────────────────────────────
// FRED Economic Calendar Provider
// Time-to-next-high-impact-event (CPI, NFP, FOMC, PCE)
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface EconomicEvent {
  date: string
  name: string
  impact: 'high' | 'medium' | 'low'
  hoursUntil: number
}

// High-impact events that move markets
const HIGH_IMPACT_EVENTS = [
  'FOMC', 'Federal Funds Rate', 'CPI', 'Consumer Price Index',
  'NFP', 'Non-Farm Payrolls', 'PCE', 'GDP', 'Unemployment Rate',
  'PPI', 'Retail Sales', 'ISM PMI'
]

async function fetchEconomicCalendar(): Promise<EconomicEvent[]> {
  try {
    // Use FRED API for scheduled releases
    const apiKey = process.env.FRED_API_KEY
    if (!apiKey) return []

    const res = await fetch(
      `https://api.stlouisfed.org/fred/releases/dates?api_key=${apiKey}&file_type=json&sort_order=asc&include_release_dates_with_no_data=true&limit=50`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) return []

    const data = (await res.json()) as {
      release_dates?: Array<{ date: string; release_id: number; release_name: string }>
    }

    const now = Date.now()
    const events: EconomicEvent[] = []

    for (const release of data.release_dates ?? []) {
      const eventDate = new Date(release.date).getTime()
      if (eventDate < now) continue // Skip past events

      const hoursUntil = (eventDate - now) / (1000 * 60 * 60)
      const isHighImpact = HIGH_IMPACT_EVENTS.some(keyword =>
        release.release_name?.toLowerCase().includes(keyword.toLowerCase())
      )

      events.push({
        date: release.date,
        name: release.release_name ?? 'Economic Release',
        impact: isHighImpact ? 'high' : 'low',
        hoursUntil,
      })
    }

    return events.sort((a, b) => a.hoursUntil - b.hoursUntil).slice(0, 10)
  } catch {
    return []
  }
}

// Score: 0 = event imminent, 100 = no event for 7+ days
function normalizeEventProximity(hoursUntil: number): number {
  if (hoursUntil <= 0) return 0
  if (hoursUntil >= 168) return 100 // 7 days
  return (hoursUntil / 168) * 100
}

function getHumanReadable(events: EconomicEvent[]): string {
  const nextHigh = events.find(e => e.impact === 'high')
  if (nextHigh) {
    const hours = Math.round(nextHigh.hoursUntil)
    return `${nextHigh.name} in ${hours}h — expect volatility`
  }
  const next = events[0]
  if (next) {
    return `Next: ${next.name} in ${Math.round(next.hoursUntil)}h`
  }
  return 'No upcoming economic events'
}

class FredCalendarProvider implements MarketDataProvider {
  readonly id = 'fred-calendar'
  readonly tier = 'macro' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'forex', 'idx_bonds', 'commodity', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: events } = await getCached('fred:calendar', config.ttlMs, fetchEconomicCalendar)

    const nextHighImpact = events.find(e => e.impact === 'high')
    if (!nextHighImpact) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: 'MACRO', // Market-wide
      market,
      rawValue: nextHighImpact.hoursUntil,
      normalizedScore: normalizeEventProximity(nextHighImpact.hoursUntil),
      direction: 'neutral', // Context signal, not directional
      confidence: 0.9,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(events),
    }
  }
}

export const fredCalendarProvider = new FredCalendarProvider()
