// ─────────────────────────────────────────────────────────────
// Open-Meteo Weather Fetcher — Tier 0, free, no API key
// Current forecasts + historical archives for z-score anomaly detection
// Docs: https://open-meteo.com/en/docs
// ─────────────────────────────────────────────────────────────

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive'

const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const cache = new Map<string, { data: unknown; ts: number }>()

// ─── Types ─────────────────────────────────────────────────

export interface DailyForecast {
  date: string
  temperatureMax: number | null
  temperatureMin: number | null
  precipitation: number | null
  windSpeedMax: number | null
  et0FaoEvapotranspiration: number | null
}

export interface WeatherAnomaly {
  metric: string
  currentValue: number
  historicalMean: number
  historicalStdDev: number
  zScore: number
  /** |zScore| ≥ 2 is a significant anomaly */
  isAnomaly: boolean
}

export interface RegionPreset {
  name: string
  lat: number
  lon: number
  description: string
  commodities: string[]
}

// ─── Region Presets ────────────────────────────────────────

export const REGION_PRESETS: Record<string, RegionPreset> = {
  sumatra: {
    name: 'Sumatra',
    lat: -0.5,
    lon: 101.4,
    description: 'Major palm oil production region',
    commodities: ['CPO', 'Palm Oil'],
  },
  texas: {
    name: 'Texas',
    lat: 31.0,
    lon: -100.0,
    description: 'US energy hub — crude oil, natural gas, wind',
    commodities: ['WTI Crude', 'Natural Gas'],
  },
  'black-sea': {
    name: 'Black Sea',
    lat: 43.5,
    lon: 35.0,
    description: 'Global wheat basket — Russia, Ukraine, Kazakhstan',
    commodities: ['Wheat', 'Corn', 'Sunflower Oil'],
  },
  midwest: {
    name: 'US Midwest',
    lat: 41.5,
    lon: -89.0,
    description: 'US corn and soybean belt',
    commodities: ['Corn', 'Soybeans'],
  },
  india: {
    name: 'India',
    lat: 20.5,
    lon: 78.9,
    description: 'Spices, sugar, cotton, rice production',
    commodities: ['Sugar', 'Cotton', 'Rice'],
  },
}

// ─── Forecast ──────────────────────────────────────────────

/**
 * Get 7-day weather forecast for coordinates.
 * Tier 0 — Open-Meteo, no API key required.
 */
export async function getWeatherForecast(
  lat: number,
  lon: number,
): Promise<DailyForecast[]> {
  const cacheKey = `forecast:${lat}:${lon}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data as DailyForecast[]

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,et0_fao_evapotranspiration',
    timezone: 'auto',
    forecast_days: '7',
  })

  try {
    const res = await fetch(`${FORECAST_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`)

    const data = await res.json() as OpenMeteoDailyResponse
    const forecasts = mapDailyResponse(data)
    cache.set(cacheKey, { data: forecasts, ts: Date.now() })
    return forecasts
  } catch {
    return (cached?.data as DailyForecast[]) ?? []
  }
}

// ─── Historical ────────────────────────────────────────────

/**
 * Get historical weather data for a date range.
 * Open-Meteo archive goes back to 1940.
 */
export async function getHistoricalWeather(
  lat: number,
  lon: number,
  start: string, // YYYY-MM-DD
  end: string,   // YYYY-MM-DD
): Promise<DailyForecast[]> {
  const cacheKey = `historical:${lat}:${lon}:${start}:${end}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL * 6) return cached.data as DailyForecast[]

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: start,
    end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,et0_fao_evapotranspiration',
    timezone: 'auto',
  })

  try {
    const res = await fetch(`${HISTORICAL_URL}?${params}`, {
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) throw new Error(`Open-Meteo historical ${res.status}`)

    const data = await res.json() as OpenMeteoDailyResponse
    const records = mapDailyResponse(data)
    cache.set(cacheKey, { data: records, ts: Date.now() })
    return records
  } catch {
    return (cached?.data as DailyForecast[]) ?? []
  }
}

// ─── Z-Score Anomaly Detection ────────────────────────────

/**
 * Calculate z-score of current value against historical distribution.
 * Returns anomaly details including significance flag (|z| ≥ 2).
 */
export function calculateZScore(
  currentValue: number,
  historicalValues: number[],
): WeatherAnomaly {
  const n = historicalValues.length

  if (n === 0) {
    return {
      metric: '',
      currentValue,
      historicalMean: 0,
      historicalStdDev: 0,
      zScore: 0,
      isAnomaly: false,
    }
  }

  const mean = historicalValues.reduce((a, b) => a + b, 0) / n
  const variance = historicalValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)

  const zScore = stdDev > 0 ? (currentValue - mean) / stdDev : 0

  return {
    metric: '',
    currentValue,
    historicalMean: round2(mean),
    historicalStdDev: round2(stdDev),
    zScore: round2(zScore),
    isAnomaly: Math.abs(zScore) >= 2,
  }
}

/**
 * Run anomaly detection for a region preset using last 30 days of historical
 * data vs latest forecast. Returns anomalies for temperature max and precipitation.
 */
export async function getRegionalAnomalies(
  regionKey: string,
): Promise<WeatherAnomaly[]> {
  const region = REGION_PRESETS[regionKey]
  if (!region) return []

  // Historical window: same calendar days last year for robust baseline
  const now = new Date()
  const thisYear = now.getUTCFullYear()
  const lastYear = thisYear - 1
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const start30 = `${lastYear}-${mm}-${dd}`
  const end30 = `${lastYear}-${mm}-${String(Math.min(now.getUTCDate() + 30, 28)).padStart(2, '0')}`

  const [forecast, historical] = await Promise.all([
    getWeatherForecast(region.lat, region.lon),
    getHistoricalWeather(region.lat, region.lon, start30, end30),
  ])

  if (forecast.length === 0 || historical.length === 0) return []

  const anomalies: WeatherAnomaly[] = []

  // Temperature max anomaly
  const tempMaxCurrent = forecast[0]?.temperatureMax
  const tempMaxHist = historical.map((d) => d.temperatureMax).filter(nonNull)
  if (tempMaxCurrent != null && tempMaxHist.length > 0) {
    const a = calculateZScore(tempMaxCurrent, tempMaxHist)
    a.metric = 'temperature_2m_max'
    anomalies.push(a)
  }

  // Precipitation anomaly
  const precipCurrent = forecast[0]?.precipitation
  const precipHist = historical.map((d) => d.precipitation).filter(nonNull)
  if (precipCurrent != null && precipHist.length > 0) {
    const a = calculateZScore(precipCurrent, precipHist)
    a.metric = 'precipitation_sum'
    anomalies.push(a)
  }

  return anomalies
}

// ─── Internal helpers ──────────────────────────────────────

interface OpenMeteoDailyResponse {
  daily?: {
    time?: string[]
    temperature_2m_max?: (number | null)[]
    temperature_2m_min?: (number | null)[]
    precipitation_sum?: (number | null)[]
    wind_speed_10m_max?: (number | null)[]
    et0_fao_evapotranspiration?: (number | null)[]
  }
}

function mapDailyResponse(data: OpenMeteoDailyResponse): DailyForecast[] {
  const d = data.daily
  if (!d?.time) return []

  return d.time.map((date, i) => ({
    date,
    temperatureMax: d.temperature_2m_max?.[i] ?? null,
    temperatureMin: d.temperature_2m_min?.[i] ?? null,
    precipitation: d.precipitation_sum?.[i] ?? null,
    windSpeedMax: d.wind_speed_10m_max?.[i] ?? null,
    et0FaoEvapotranspiration: d.et0_fao_evapotranspiration?.[i] ?? null,
  }))
}

function nonNull(v: number | null): v is number {
  return v !== null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
