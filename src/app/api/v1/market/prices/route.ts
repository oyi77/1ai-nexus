// ─────────────────────────────────────────────────────────────
// GET /api/v1/market/prices — Live prices for ticker strip
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  const registry = registerAllModules()

  try {
    const result = await registry.fetchOne<Record<string, { usd: number; usd_24h_change: number }>>(
      'coingecko',
      { action: 'price', ids: 'bitcoin,ethereum,solana,binancecoin,ripple,cardano', vs_currency: 'usd' }
    )
    const data = result.data ?? {}

    const coins = [
      { id: 'bitcoin', symbol: 'BTC' },
      { id: 'ethereum', symbol: 'ETH' },
      { id: 'solana', symbol: 'SOL' },
      { id: 'binancecoin', symbol: 'BNB' },
      { id: 'ripple', symbol: 'XRP' },
      { id: 'cardano', symbol: 'ADA' },
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

    return NextResponse.json({ tickers })
  } catch (err) {
    console.error('[market/prices] Error:', err)
    return NextResponse.json({ tickers: [] })
  }
}

function fmtPrice(n?: number): string {
  if (n == null) return '—'
  return n >= 1000 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`
}

function fmtChange(n?: number): string {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}
