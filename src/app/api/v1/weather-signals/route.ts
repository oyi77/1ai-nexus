// ─────────────────────────────────────────────────────────────
// GET /api/v1/weather-signals — Weather Signals API
// Actions: region forecast, anomaly detection
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  getWeatherForecast,
  getRegionalAnomalies,
  REGION_PRESETS,
  type WeatherAnomaly,
} from '@/lib/dal/weather/open-meteo'
import {
  getAffectedCommodities,
  getAffectedTickers,
  getAvailableRegions,
} from '@/lib/dal/weather/commodity-mapper'

export const dynamic = 'force-dynamic'

// ─── Handler ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const region = searchParams.get('region')

  try {
    if (action === 'anomalies') {
      return await handleAnomalies(searchParams)
    }

    if (region) {
      return await handleRegion(region)
    }

    // Default: list available regions
    return apiSuccess({
      availableRegions: getAvailableRegions(),
      presets: Object.entries(REGION_PRESETS).map(([key, p]) => ({
        key,
        name: p.name,
        lat: p.lat,
        lon: p.lon,
        description: p.description,
        commodities: p.commodities,
      })),
      usage: 'GET ?region=sumatra | ?action=anomalies | ?action=anomalies&region=sumatra',
    })
  } catch (err) {
    return apiError(`Weather signals error: ${(err as Error).message}`, 500)
  }
}

// ─── Region Forecast + Commodity Map ──────────────────────

async function handleRegion(regionKey: string) {
  const preset = REGION_PRESETS[regionKey]
  if (!preset) {
    return apiError(
      `Unknown region: ${regionKey}. Available: ${getAvailableRegions().join(', ')}`,
      400,
    )
  }

  const [forecast, anomalies] = await Promise.all([
    getWeatherForecast(preset.lat, preset.lon),
    getRegionalAnomalies(regionKey),
  ])

  // Map anomalies to affected commodities and tickers
  const commoditySignals = anomalies
    .filter((a) => a.isAnomaly)
    .flatMap((a) => {
      const commodities = getAffectedCommodities(regionKey, a)
      return commodities.map((c) => ({
        commodity: c.commodity,
        description: c.description,
        tickers: c.tickers,
        anomaly: {
          metric: a.metric,
          zScore: a.zScore,
          currentValue: a.currentValue,
          historicalMean: a.historicalMean,
        },
      }))
    })

  return apiSuccess({
    region: {
      key: regionKey,
      name: preset.name,
      lat: preset.lat,
      lon: preset.lon,
      description: preset.description,
    },
    forecast: forecast.slice(0, 7),
    anomalies,
    commoditySignals,
    signalCount: commoditySignals.length,
  })
}

// ─── All Anomalies ────────────────────────────────────────

async function handleAnomalies(searchParams: URLSearchParams) {
  const regionFilter = searchParams.get('region')

  const regionKeys = regionFilter
    ? [regionFilter]
    : getAvailableRegions()

  const results: Array<{
    region: string
    anomalies: WeatherAnomaly[]
    affectedCommodities: Array<{ commodity: string; tickers: string[] }>
  }> = []

  for (const key of regionKeys) {
    const preset = REGION_PRESETS[key]
    if (!preset) continue

    const anomalies = await getRegionalAnomalies(key)
    const significant = anomalies.filter((a) => a.isAnomaly)

    if (significant.length > 0) {
      const affectedCommodities = significant.flatMap((a) =>
        getAffectedCommodities(key, a).map((c) => ({
          commodity: c.commodity,
          tickers: c.tickers,
        })),
      )

      results.push({
        region: key,
        anomalies: significant,
        affectedCommodities,
      })
    }
  }

  return apiSuccess({
    action: 'anomalies',
    scannedRegions: regionKeys.length,
    anomalyRegions: results.length,
    results,
  })
}
