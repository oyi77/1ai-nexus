// ─────────────────────────────────────────────────────────────
// GET /api/v1/market/prices — Live prices for ticker strip
// Expanded with cross-asset tickers via Yahoo Finance
// ─────────────────────────────────────────────────────────────

import { apiSuccess, apiError } from '@/lib/api/response'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  const registry = registerAllModules()

  try {
    const cgPromise = registry.fetchOne<Record<string, { usd: number; usd_24h_change: number }>>(
      'coingecko',
      { action: 'price', ids: 'bitcoin,ethereum,solana,binancecoin,ripple,cardano', vs_currency: 'usd' }
    ).catch(() => null)

    const yfPromise = registry.fetchOne<Record<string, unknown>[]>(
      'yahoo-finance',
      { action: 'quote', symbols: '^JKSE,^GSPC,USDIDR=X,GC=F' }
    ).catch(() => null)

    const emPromise = registry.fetchOne<Record<string, unknown>>(
      'eastmoney',
      { action: 'get' }
    ).catch(() => null)

    const [cgResult, yfResult, emResult] = await Promise.all([cgPromise, yfPromise, emPromise])

    const data = cgResult?.data ?? {}

    const coins = [
      { id: 'bitcoin', symbol: 'BTC' },
      { id: 'ethereum', symbol: 'ETH' },
      { id: 'solana', symbol: 'SOL' },
    ]

    const tickers = coins.map(c => {
      const coin = data[c.id]
      return {
        symbol: c.symbol,
        price: coin ? fmtPrice(coin.usd) : '—',
        change: coin ? fmtChange(coin.usd_24h_change) : '—',
        positive: (coin?.usd_24h_change ?? 0) >= 0,
      }
    })

    if (yfResult?.data && Array.isArray(yfResult.data)) {
      for (const item of yfResult.data) {
        const rec = item as Record<string, unknown>
        let sym = String(rec.symbol ?? '')
        if (sym === '^JKSE') sym = 'IHSG'
        if (sym === '^GSPC') sym = 'S&P 500'
        if (sym === 'USDIDR=X') sym = 'USD/IDR'
        if (sym === 'GC=F') sym = 'GOLD'
        
        const price = rec.regularMarketPrice as number | undefined
        const changePct = rec.regularMarketChangePercent as number | undefined
        tickers.push({
          symbol: sym,
          price: price ? fmtPriceRaw(price, sym === 'USD/IDR' ? 0 : 2) : '—',
          change: changePct ? fmtChange(changePct) : '—',
          positive: (changePct ?? 0) >= 0,
        })
      }
    }

    const emData = emResult?.data as Record<string, unknown> | undefined
    const emInner = emData?.data as Record<string, unknown> | undefined
    if (emInner?.diff && Array.isArray(emInner.diff)) {
      const aShares = emInner.diff as Record<string, unknown>[]
      if (aShares.length > 0) {
         // Add Shanghai Composite or top A-share just as an example
         const top = aShares[0]
         if (top) {
           tickers.push({
             symbol: 'CSI300 (EastMoney)',
             price: String(top.f2),
             change: fmtChange(top.f3 as number),
             positive: (top.f3 as number) >= 0
           })
         }
      }
    }


    const r = apiSuccess({ tickers })
    r.headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    return r
  } catch (err) {
    console.error('[market/prices] Error:', err)
    return apiError('Failed to fetch market prices', 502)
  }
}

function fmtPrice(n?: number): string {
  if (n == null) return '—'
  return n >= 1000 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`
}

function fmtPriceRaw(n: number, decimals: number = 2): string {
  return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: decimals }) : n.toFixed(decimals)
}

function fmtChange(n?: number): string {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}
