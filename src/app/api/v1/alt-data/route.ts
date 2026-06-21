import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

async function safeFetch(registry: ReturnType<typeof registerAllModules>, id: string) {
  try {
    const res = await registry.fetchOne<any>(id, { action: 'get' })
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

    return NextResponse.json({
      usgs, gdacs, google, weibo, zhihu, eastmoney,
      weather, eonet, reliefweb, flights, fema, boc, uk,
      hackernews: hn,
      timestamp: Date.now()
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  } catch (err) {
    console.error('[api/v1/alt-data] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
