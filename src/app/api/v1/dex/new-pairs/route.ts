import { apiSuccess, apiError } from '@/lib/api/response'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const network = searchParams.get('network') || 'solana'

    // Fetch new pools from GeckoTerminal
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?page=1`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 15 } // Extremely aggressive caching for "new" pairs
    })

    if (!res.ok) {
      return apiError(`Failed to fetch new pairs: ${res.statusText}`, res.status)
    }

    const data = await res.json() as {
      data: Array<{
        attributes: {
          address: string
          name: string
          base_token_price_usd: string
          fdv_usd: string
          reserve_in_usd: string
          pool_created_at: string
          volume_usd: { m5: string, h1: string }
          transactions: { m5: { buys: number, sells: number } }
        }
      }>
    }

    const now = new Date().getTime()

    const items = data.data.map(pool => {
      const created = new Date(pool.attributes.pool_created_at).getTime()
      const ageMinutes = Math.floor((now - created) / 60000)
      const liquidity = parseFloat(pool.attributes.reserve_in_usd) || 0
      const fdv = parseFloat(pool.attributes.fdv_usd) || 0
      
      // Auto-RugCheck Algorithm (Heuristic)
      let rugRisk = 'Medium'
      let riskScore = 50
      
      if (liquidity < 1000) {
        rugRisk = 'High' // Honeypot / micro liquidity
        riskScore = 90
      } else if (liquidity > 20000 && fdv > 50000) {
        rugRisk = 'Low' // Decent initial LP
        riskScore = 15
      }

      return {
        address: pool.attributes.address,
        name: pool.attributes.name,
        priceUsd: parseFloat(pool.attributes.base_token_price_usd) || 0,
        fdv,
        liquidity,
        ageMinutes,
        volume5m: parseFloat(pool.attributes.volume_usd?.m5) || 0,
        buys5m: pool.attributes.transactions?.m5?.buys || 0,
        sells5m: pool.attributes.transactions?.m5?.sells || 0,
        rugRisk,
        riskScore,
        network
      }
    })

    // Sort by age (newest first)
    items.sort((a, b) => a.ageMinutes - b.ageMinutes)

    const r = apiSuccess({ items, count: items.length })
    r.headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    return r
  } catch (error) {
    console.error('DEX new pairs error:', error)
    return apiError('Failed to fetch new DEX pairs', 500)
  }
}
