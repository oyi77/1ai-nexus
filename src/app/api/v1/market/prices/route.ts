// ─────────────────────────────────────────────────────────────
// GET /api/v1/market/prices — Live prices for ticker strip
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  const registry = registerAllModules()

  try {
    const result = await registry.fetchOne('coingecko', { action: 'price', ids: 'bitcoin,ethereum,solana', vs_currency: 'usd' })
    const data = result.data as Record<string, { usd: number; usd_24h_change: number }>

    const tickers = [
      { symbol: 'BTC', price: fmtPrice(data.bitcoin?.usd), change: fmtChange(data.bitcoin?.usd_24h_change), positive: (data.bitcoin?.usd_24h_change ?? 0) >= 0 },
      { symbol: 'ETH', price: fmtPrice(data.ethereum?.usd), change: fmtChange(data.ethereum?.usd_24h_change), positive: (data.ethereum?.usd_24h_change ?? 0) >= 0 },
      { symbol: 'SOL', price: fmtPrice(data.solana?.usd), change: fmtChange(data.solana?.usd_24h_change), positive: (data.solana?.usd_24h_change ?? 0) >= 0 },
    ]

    return NextResponse.json({ tickers })
  } catch {
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
