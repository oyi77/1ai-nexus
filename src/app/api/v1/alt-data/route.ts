import { apiSuccess, apiError } from '@/lib/api/response'
import { registerAllModules } from '@/lib/modules'

async function safeFetch(registry: ReturnType<typeof registerAllModules>, id: string) {
  try {
    const res = await registry.fetchOne<Record<string, unknown>>(id, { action: 'get' })
    return res.data
  } catch {
    return null
  }
}

export async function GET() {
  const registry = registerAllModules()

  try {
    const [
      usgs, gdacs, google, weibo, zhihu, eastmoney,
      weather, eonet, reliefweb, flights, fema, boc, uk, hn
    ] = await Promise.all([
      safeFetch(registry, 'usgs-earthquakes'),
      safeFetch(registry, 'gdacs-alerts'),
      safeFetch(registry, 'google-trends'),
      safeFetch(registry, 'weibo-hot'),
      safeFetch(registry, 'zhihu-trends'),
      safeFetch(registry, 'eastmoney'),
      safeFetch(registry, 'open-meteo'),
      safeFetch(registry, 'nasa-eonet'),
      safeFetch(registry, 'reliefweb'),
      safeFetch(registry, 'adsb-flight-tracking'),
      safeFetch(registry, 'openfema'),
      safeFetch(registry, 'bank-of-canada'),
      safeFetch(registry, 'uk-ons'),
      safeFetch(registry, 'hackernews'),
    ])

    const response = apiSuccess({
      usgs, gdacs, google, weibo, zhihu, eastmoney,
      weather, eonet, reliefweb, flights, fema, boc, uk,
      hackernews: hn,
      timestamp: Date.now()
    })
    response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    return response
  } catch (err) {
    console.error('[api/v1/alt-data] Error:', err)
    return apiError(String(err), 500)
  }
}
