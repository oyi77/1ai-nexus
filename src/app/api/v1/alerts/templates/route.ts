// ─────────────────────────────────────────────────────────────
// GET /api/v1/alerts/templates — Pre-built alert templates
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'

interface AlertTemplate {
  id: string
  name: string
  description: string
  icon: string
  condition: string
  category: string
}

const TEMPLATES: AlertTemplate[] = [
  { id: 'whale-buy', name: 'Whale Buy', description: 'Alert when a whale buys > $1M of any token', icon: '🐋', condition: 'buy_value > 1000000', category: 'whale' },
  { id: 'whale-sell', name: 'Whale Sell', description: 'Alert when a whale sells > $1M of any token', icon: '🐋', condition: 'sell_value > 1000000', category: 'whale' },
  { id: 'price-surge', name: 'Price Surge', description: 'Alert when any token price increases > 50% in 1h', icon: '📈', condition: 'price_change_1h > 50', category: 'price' },
  { id: 'price-crash', name: 'Price Crash', description: 'Alert when any token price drops > 30% in 1h', icon: '📉', condition: 'price_change_1h < -30', category: 'price' },
  { id: 'new-token-sm', name: 'New Token + Smart Money', description: 'Alert when a new token gets buys from labeled smart money wallets', icon: '🆕', condition: 'new_token AND smart_money_buy', category: 'discovery' },
  { id: 'funding-extreme', name: 'Extreme Funding Rate', description: 'Alert when BTC/ETH funding rate exceeds 0.1%', icon: '💰', condition: 'funding_rate > 0.001', category: 'derivatives' },
  { id: 'liquidation-cascade', name: 'Liquidation Cascade', description: 'Alert when total liquidations exceed $100M in 1h', icon: '💥', condition: 'liquidations_1h > 100000000', category: 'derivatives' },
  { id: 'fear-extreme', name: 'Extreme Fear', description: 'Alert when Fear & Greed Index drops below 20', icon: '😱', condition: 'fear_greed < 20', category: 'sentiment' },
  { id: 'greed-extreme', name: 'Extreme Greed', description: 'Alert when Fear & Greed Index rises above 80', icon: '🤑', condition: 'fear_greed > 80', category: 'sentiment' },
  { id: 'tvl-drop', name: 'Protocol TVL Drop', description: 'Alert when a top-50 protocol TVL drops > 20% in 24h', icon: '🔗', condition: 'tvl_change_24h < -20', category: 'defi' },
  { id: 'stablecoin-depeg', name: 'Stablecoin Depeg', description: 'Alert when USDT/USDC/DAI deviates > 1% from $1', icon: '💵', condition: 'stablecoin_price < 0.99 OR stablecoin_price > 1.01', category: 'defi' },
  { id: 'new-listing', name: 'New Exchange Listing', description: 'Alert when a token gets listed on Binance/Coinbase', icon: '🏦', condition: 'new_listing_binance OR new_listing_coinbase', category: 'market' },
]

export async function GET() {
  return NextResponse.json({ data: { templates: TEMPLATES, count: TEMPLATES.length }, error: null }, { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200' } })
}
