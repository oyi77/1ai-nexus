import { type NextRequest } from "next/server"
import { apiJson } from "@/lib/api/response"
import { INDONESIA_INDICATORS } from "@/lib/modules/macro/indonesia"

export const dynamic = "force-dynamic"

interface IndonesiaMacroEntry {
  id: string
  title: string
  unit: string
  category: string
  latestValue: string
  latestDate: string
}

// In-memory cache
let cachedData: IndonesiaMacroEntry[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

async function fetchIndonesiaData(): Promise<IndonesiaMacroEntry[]> {
  if (cachedData && Date.now() - cacheTimestamp <= CACHE_TTL) {
    return cachedData
  }

  const entries: IndonesiaMacroEntry[] = []

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
      })
    } catch {
      // Skip failed indicators
    }
  }

  cachedData = entries
  cacheTimestamp = Date.now()
  return entries
}

export async function GET(_request: NextRequest) {
  try {
    const data = await fetchIndonesiaData()
    return apiJson(data, { headers: { 'Cache-Control': 'public, max-age=1800' } })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 500 })
  }
}
