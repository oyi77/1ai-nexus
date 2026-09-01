import { type NextRequest } from "next/server"
import { apiJson } from "@/lib/api/response"
import { INDONESIA_INDICATORS } from "@/lib/modules/macro/bi/statistics"

export const dynamic = "force-dynamic"

interface IndonesiaMacroEntry {
  id: string
  title: string
  unit: string
  category: string
  latestValue: string
  latestDate: string
  source: 'world-bank' | 'fred' | 'bi'
}

// In-memory cache
let cachedData: { entries: IndonesiaMacroEntry[]; biRate: { value: string; date: string } | null } | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

async function fetchIndonesiaData(): Promise<{ entries: IndonesiaMacroEntry[]; biRate: { value: string; date: string } | null }> {
  if (cachedData && Date.now() - cacheTimestamp <= CACHE_TTL) {
    return cachedData
  }

  const entries: IndonesiaMacroEntry[] = []

  // 1. World Bank annual data (existing)
  for (const [id, meta] of Object.entries(INDONESIA_INDICATORS)) {
    const url = `https://api.worldbank.org/v2/country/IDN/indicator/${meta.wbId}?format=json&per_page=5`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const json: unknown = await res.json()
      if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) continue

      const latest = json[1].find((obs: { value: number | null }) => obs.value !== null)
      if (!latest) continue

      entries.push({
        id,
        title: meta.title,
        unit: meta.unit,
        category: meta.category,
        latestValue: meta.transform(latest.value as number),
        latestDate: latest.date,
        source: 'world-bank',
      })
    } catch {
      // Skip failed indicators
    }
  }

  // 2. FRED data for Indonesia (recent monthly/quarterly) — requires FRED_API_KEY
  let biRate: { value: string; date: string } | null = null
  const fredApiKey = process.env.FRED_API_KEY

  if (!fredApiKey) {
    entries.push({
      id: 'FRED-NO-KEY',
      title: 'FRED data unavailable — set FRED_API_KEY env var (free from fred.stlouisfed.org)',
      unit: '',
      category: 'config',
      latestValue: 'missing key',
      latestDate: new Date().toISOString().slice(0, 10),
      source: 'fred',
    })
  } else {
    const fredSeries: Array<{ id: string; title: string; unit: string; category: string; transform: (v: number) => string }> = [
      { id: 'IDNCPIALLMINMEI', title: 'Indonesia CPI (Monthly)', unit: 'Index', category: 'inflation', transform: (v) => v.toFixed(1) },
      { id: 'IDNIRNST', title: 'BI Rate (Interbank)', unit: '%', category: 'rates', transform: (v) => `${v.toFixed(2)}%` },
      { id: 'IDNGDPNQDSMEI', title: 'Indonesia GDP (Quarterly)', unit: 'IDR B', category: 'growth', transform: (v) => `${(v / 1e3).toFixed(0)}T` },
    ]

    for (const series of fredSeries) {
      try {
        const { registerAllModules } = await import('@/lib/modules')
        const registry = registerAllModules()
        const result = await registry.fetchOne('fred', { series: series.id, limit: 3 })
        const data = result?.data as { observations?: Array<{ date: string; value: number | null }> } | undefined
        const obs = data?.observations?.find(o => o.value !== null)
        if (obs && obs.value != null) {
          const entry: IndonesiaMacroEntry = {
            id: series.id,
            title: series.title,
            unit: series.unit,
            category: series.category,
            latestValue: series.transform(obs.value),
            latestDate: obs.date,
            source: 'fred',
          }
          entries.push(entry)

          if (series.id === 'IDNIRNST') {
            biRate = { value: series.transform(obs.value), date: obs.date }
          }
        }
      } catch {
        // FRED series not available
      }
    }
  }
  const result = { entries, biRate }
  cachedData = result
  cacheTimestamp = Date.now()
  return result
}

export async function GET(_request: NextRequest) {
  try {
    const data = await fetchIndonesiaData()
    return apiJson(data, { headers: { 'Cache-Control': 'public, max-age=1800' } })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 500 })
  }
}
