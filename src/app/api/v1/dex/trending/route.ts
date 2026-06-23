import { apiSuccess, apiError } from '@/lib/api/response'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const network = searchParams.get('network') || 'solana'

    // Free GeckoTerminal API (No key required)
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`, {
      headers: {
        'Accept': 'application/json'
      },
      next: { revalidate: 60 }
    })

    if (!res.ok) {
      return apiError(`Failed to fetch from GeckoTerminal: ${res.statusText}`, res.status)
    }

    const data = await res.json() as {
      data: Array<{
        attributes: {
          address: string
          name: string
          base_token_price_usd: string
          fdv_usd: string
          volume_usd: { h24: string }
          price_change_percentage: { h24: string }
          transactions: {
            h24: { buys: number, sells: number }
            m5: { buys: number, sells: number }
          }
        }
      }>
    }

    const items = data.data.map(pool => ({
      address: pool.attributes.address,
      name: pool.attributes.name,
      priceUsd: parseFloat(pool.attributes.base_token_price_usd) || 0,
      fdv: parseFloat(pool.attributes.fdv_usd) || 0,
      volume24h: parseFloat(pool.attributes.volume_usd?.h24) || 0,
      priceChange24h: parseFloat(pool.attributes.price_change_percentage?.h24) || 0,
      buys24h: pool.attributes.transactions?.h24?.buys || 0,
      sells24h: pool.attributes.transactions?.h24?.sells || 0,
      buys5m: pool.attributes.transactions?.m5?.buys || 0,
      sells5m: pool.attributes.transactions?.m5?.sells || 0,
      network
    }))

    const r = apiSuccess({ items, count: items.length })
    r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    return r
  } catch (error) {
    console.error('DEX trending error:', error)
    return apiError('Failed to fetch DEX trending data', 500)
  }
}
