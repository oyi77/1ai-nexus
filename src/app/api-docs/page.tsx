"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'

interface ApiEndpoint {
  method: string
  path: string
  description: string
  category: string
  params?: string
  example?: string
  response?: string
}

const API_ENDPOINTS: ApiEndpoint[] = [
  // ─── Market Data ─────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/market/prices',
    description: 'Real-time prices for all tracked assets (crypto, equities, forex)',
    category: 'Market Data',
    params: 'symbols=BTC,ETH,AAPL (optional, comma-separated)',
    example: 'curl https://tracker.aitradepulse.com/api/v1/market/prices',
    response: '{ data: { BTC: { price: 59502, change: -0.5 }, ... } }',
  },
  {
    method: 'GET',
    path: '/api/v1/ohlcv',
    description: 'OHLCV candlestick data for any symbol',
    category: 'Market Data',
    params: 'symbol=BTC-USD&interval=1d&range=1mo',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/ohlcv?symbol=BTC-USD&interval=1d&range=1mo"',
    response: '{ data: { symbol: "BTC-USD", candles: [{ time: 1688169600, open: 30000, high: 31000, low: 29500, close: 30500, volume: 15000 }] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/modules/fetch',
    description: 'Universal data fetcher — fetch from any registered data module',
    category: 'Market Data',
    params: 'module=yahoo-finance&action=quote&symbols=AAPL,MSFT',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=AAPL"',
    response: '{ data: [{ symbol: "AAPL", regularMarketPrice: 195.50, regularMarketChangePercent: 1.2 }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/derivatives',
    description: 'Crypto derivatives data — futures, options, funding rates',
    category: 'Market Data',
    example: 'curl https://tracker.aitradepulse.com/api/v1/derivatives',
    response: '{ data: { futures: [...], options: [...], fundingRates: [...] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/orderbook',
    description: 'Order book depth for specified symbol',
    category: 'Market Data',
    params: 'symbol=BTCUSDT&exchange=binance',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/orderbook?symbol=BTCUSDT"',
    response: '{ data: { bids: [[price, qty]], asks: [[price, qty]], spread: 0.5 } }',
  },

  // ─── Pairs & DEX ────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/dex/trending',
    description: 'Trending DEX pairs on Solana/Ethereum/Base',
    category: 'Pairs & DEX',
    params: 'network=solana (default)',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/dex/trending?network=solana"',
    response: '{ data: { items: [{ name: "SOL/USDC", price: 145.5, volume24h: 5000000, liquidity: 2000000 }] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/dex/new-pairs',
    description: 'Newly created DEX pairs (Pump.fun, Raydium)',
    category: 'Pairs & DEX',
    params: 'network=solana',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/dex/new-pairs?network=solana"',
    response: '{ data: { items: [{ name: "TOKEN/SOL", price: 0.001, fdv: 100000, ageMinutes: 5 }] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/tokens',
    description: 'Token list with prices, market cap, volume',
    category: 'Pairs & DEX',
    example: 'curl https://tracker.aitradepulse.com/api/v1/tokens',
    response: '{ data: [{ symbol: "BTC", price: 59502, marketCap: 1.1e12, volume24h: 25e9 }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/trending-coins',
    description: 'Trending cryptocurrencies by volume/momentum',
    category: 'Pairs & DEX',
    example: 'curl https://tracker.aitradepulse.com/api/v1/trending-coins',
    response: '{ data: [{ coin: "bitcoin", score: 95, price: 59502 }] }',
  },

  // ─── Meme Alpha ─────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/meme/leaderboard',
    description: 'Multi-platform memecoin discovery leaderboard (11 sources)',
    category: 'Meme',
    params: 'platform=all|bitget|gate|botx|dexscreener|birdeye|geckoterminal&limit=50&explain=1',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/meme/leaderboard?platform=all&limit=10&explain=1"',
    response: '{ data: { tokens: [{ symbol: "nub", price: 0.01, ... }], meta: { total: 209, ... }, explanations: { "solana:addr": { score: 1.4, reasons: [{ code: "VOLUME_ACTIVITY", points: 0.7 }] } } } }',
  },
  {
    method: 'GET',
    path: '/api/v1/meme/risk',
    description: 'Honeypot / rug-pull risk audit per token contract',
    category: 'Meme',
    params: 'platform=all|bitget|gate|botx|birdeye|rugcheck&chain=solana&contract=0x...',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/meme/risk?platform=all&chain=solana&contract=So11111111111111111111111111111111111111112"',
    response: '{ data: [{ riskLevel: 3, riskLabel: "high", riskCounts: { high: 37, middle: 6, low: 18 }, top10HolderPercent: 0.19 }] }',
  },

  // ─── Macro & Economics ──────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/macro',
    description: '22 US macro indicators (FRED + Treasury + World Bank)',
    category: 'Macro',
    example: 'curl https://tracker.aitradepulse.com/api/v1/macro',
    response: '{ data: { indicators: [{ id: "FEDFUNDS", name: "Fed Funds Rate", latestValue: 3.63, unit: "%" }] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/indonesia-macro',
    description: '8 Indonesian macro indicators (World Bank)',
    category: 'Macro',
    example: 'curl https://tracker.aitradepulse.com/api/v1/indonesia-macro',
    response: '{ data: [{ id: "IDN-GDP", title: "Indonesia GDP", latestValue: "1396", unit: "$B" }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/calendar',
    description: 'Economic calendar — upcoming events',
    category: 'Macro',
    example: 'curl https://tracker.aitradepulse.com/api/v1/calendar',
    response: '{ data: { events: [{ title: "Fed Rate Decision", date: "2026-07-30", impact: "high" }] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/correlations',
    description: 'Cross-asset correlation data',
    category: 'Macro',
    example: 'curl https://tracker.aitradepulse.com/api/v1/correlations',
    response: '{ data: { pairs: [{ a: "BTC", b: "SPY", correlation: 0.45 }] } }',
  },

  // ─── On-Chain Intelligence ──────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/whale-alert',
    description: 'Whale transactions (>$100K) across chains',
    category: 'On-Chain',
    example: 'curl https://tracker.aitradepulse.com/api/v1/whale-alert',
    response: '{ data: [{ tx: "0xabc...", amount: 500, symbol: "ETH", from: "0x123...", to: "0x456..." }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/smart-money',
    description: 'Smart money wallet tracking',
    category: 'On-Chain',
    example: 'curl https://tracker.aitradepulse.com/api/v1/smart-money',
    response: '{ data: [{ address: "0x123...", score: 95, lastTrade: "2026-06-30" }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/entities',
    description: 'Known entity labels (exchanges, funds, whales)',
    category: 'On-Chain',
    example: 'curl https://tracker.aitradepulse.com/api/v1/entities',
    response: '{ data: [{ name: "Binance", type: "exchange", addresses: ["0x123..."] }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/mev',
    description: 'MEV activity — sandwiches, frontruns, liquidations',
    category: 'On-Chain',
    example: 'curl https://tracker.aitradepulse.com/api/v1/mev',
    response: '{ data: { sandwiches: [...], frontruns: [...], liquidations: [...] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/exchange-flow',
    description: 'Exchange inflow/outflow tracking',
    category: 'On-Chain',
    example: 'curl https://tracker.aitradepulse.com/api/v1/exchange-flow',
    response: '{ data: { inflow: 1500, outflow: 2000, net: 500, symbol: "BTC" } }',
  },
  {
    method: 'GET',
    path: '/api/v1/top-traders',
    description: 'Top performing wallets by PnL',
    category: 'On-Chain',
    example: 'curl https://tracker.aitradepulse.com/api/v1/top-traders',
    response: '{ data: [{ address: "0x123...", pnl: 500000, winRate: 0.75 }] }',
  },

  // ─── DeFi ───────────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/yields',
    description: 'DeFi yield farming opportunities (15K+ pools)',
    category: 'DeFi',
    example: 'curl https://tracker.aitradepulse.com/api/v1/yields',
    response: '{ data: [{ pool: "Aave USDC", apy: 5.2, tvl: 500000000 }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/stablecoins',
    description: 'Stablecoin market data and flows',
    category: 'DeFi',
    example: 'curl https://tracker.aitradepulse.com/api/v1/stablecoins',
    response: '{ data: [{ symbol: "USDT", supply: 110e9, peg: 1.0 }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/revenue',
    description: 'Protocol revenue tracking',
    category: 'DeFi',
    example: 'curl https://tracker.aitradepulse.com/api/v1/revenue',
    response: '{ data: [{ protocol: "Ethereum", revenue24h: 5000000 }] }',
  },
  {
    method: 'GET',
    path: '/api/v1/sectors',
    description: 'Crypto sector performance',
    category: 'DeFi',
    example: 'curl https://tracker.aitradepulse.com/api/v1/sectors',
    response: '{ data: [{ sector: "DeFi", change24h: 2.5, marketCap: 50e9 }] }',
  },

  // ─── News & Sentiment ───────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/news',
    description: 'Aggregated news from 30+ RSS sources',
    category: 'News',
    params: 'category=markets&limit=20',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/news?limit=5"',
    response: '{ data: { items: [{ title: "Bitcoin surges...", source: "coindesk", publishedAt: "2026-06-30" }] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/fear-greed',
    description: 'Crypto Fear & Greed Index',
    category: 'Sentiment',
    example: 'curl https://tracker.aitradepulse.com/api/v1/fear-greed',
    response: '{ data: { value: 62, classification: "Greed" } }',
  },
  {
    method: 'GET',
    path: '/api/v1/sentiment',
    description: 'Market sentiment analysis',
    category: 'Sentiment',
    example: 'curl https://tracker.aitradepulse.com/api/v1/sentiment',
    response: '{ data: { overall: "bullish", score: 72 } }',
  },

  // ─── Trading ────────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/trading',
    description: 'Trading terminal — Alpaca paper trading integration',
    category: 'Trading',
    params: 'action=account|positions|orders',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/trading?action=positions"',
    response: '{ data: [{ symbol: "AAPL", qty: "100", unrealizedPnl: "275.00" }] }',
  },
  {
    method: 'POST',
    path: '/api/v1/trading',
    description: 'Place order via Alpaca paper trading',
    category: 'Trading',
    params: '{ symbol: "AAPL", side: "buy", type: "market", qty: 10 }',
    example: 'curl -X POST https://tracker.aitradepulse.com/api/v1/trading -H "Content-Type: application/json" -d \'{"symbol":"AAPL","side":"buy","type":"market","qty":10}\'',
    response: '{ data: { id: "abc123", status: "new", symbol: "AAPL" } }',
  },

  // ─── Compliance ─────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/compliance',
    description: 'Audit trail — all trading and account actions',
    category: 'Compliance',
    params: 'action=log|stats&category=TRADE&limit=100',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/compliance?action=log&limit=10"',
    response: '{ data: { events: [{ action: "ORDER_SUBMITTED", timestamp: "2026-06-30", details: "BUY 10 AAPL" }] } }',
  },

  // ─── Screener ──────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/screener',
    description: 'Multi-asset stock screener with filters',
    category: 'Screener',
    params: 'sector=Technology&exchange=IDX&minMarketCap=1000000000&maxPE=25&sortBy=marketCap&limit=50',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/screener?sector=Technology&sortBy=marketCap&limit=10"',
    response: '{ data: { results: [{ symbol: "AAPL", price: 195.50, pe: 28.5, marketCap: 3e12 }], count: 10 } }',
  },

  {
    method: 'GET',
    path: '/api/v1/equities/universe',
    description: 'Equity universe: IDX by default, or one of 14 global markets (TradingView scan)',
    category: 'Screener',
    params: 'market=us|japan|uk|germany|hongkong|india|canada|korea|taiwan|australia|singapore|brazil|switzerland|netherlands · markets=1 (catalog) · group=idx-banks|… · quotes=1 (IDX OHLCV embed)',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/equities/universe?market=japan"',
    response: '{ data: { stocks: [{ symbol: "7203.T", name: "Toyota Motor", exchange: "TSE" }], meta: { captured: 3782, totalCount: 3914 } } }',
  },

  {
    method: 'GET',
    path: '/api/v1/saham/fundamentals',
    description: 'IDX fundamental ratios from the nightly harvest (PER, PBV, ROE %, DER, EPS, marketCap, divYield %)',
    category: 'Screener',
    params: 'symbol=BBCA (optional — omit for the whole universe)',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/saham/fundamentals?symbol=BBCA"',
    response: '{ data: { symbol: "BBCA", per: 13.62, pbv: 2.81, roe: 21.82, der: 0.20, eps: 471.83, marketCap: 788960300000000, dividendYield: 5.56 } }',
  },

  // ─── Growth & Social ──────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/analytics',
    description: 'Pageview analytics — DAU, MAU, total views, top pages',
    category: 'System',
    example: 'curl https://tracker.aitradepulse.com/api/v1/analytics',
    response: '{ data: { dau: 12, mau: 300, total: 5000, topPages: [{ path: "/", count: 200 }] } }',
  },
  {
    method: 'GET',
    path: '/api/v1/token/thesis',
    description: 'Per-token trade thesis from aggregated alpha signals',
    category: 'Market Data',
    params: 'symbol=BTC',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/token/thesis?symbol=BTC"',
    response: '{ data: { symbol: "BTC", thesis: "BULLISH", weightedScore: 42, confidence: 0.8, counts: { bullish: 3, bearish: 1, neutral: 2 }, totalSignals: 6 } }',
  },
  {
    method: 'GET',
    path: '/api/v1/follows',
    description: 'List followed traders/wallets (auth required)',
    category: 'Social',
    example: 'curl https://tracker.aitradepulse.com/api/v1/follows',
    response: '{ data: { follows: [{ type: "entity", id: "abc", label: "Binance" }] } }',
  },
  {
    method: 'POST',
    path: '/api/v1/follows',
    description: 'Follow a trader/wallet (auth required)',
    category: 'Social',
    params: '{ type: "entity|wallet", id: "..." }',
    example: 'curl -X POST https://tracker.aitradepulse.com/api/v1/follows -H "Content-Type: application/json" -d \'{"type":"entity","id":"abc"}\'',
    response: '{ data: { following: true } }',
  },
  {
    method: 'GET',
    path: '/api/v1/follows/feed',
    description: 'Recent activity from followed traders (auth required)',
    category: 'Social',
    params: 'limit=20',
    example: 'curl "https://tracker.aitradepulse.com/api/v1/follows/feed?limit=20"',
    response: '{ data: { items: [{ wallet: "0x...", type: "transfer", amountUsd: 1000, timestamp: "..." }] } }',
  },
  {
    method: 'POST',
    path: '/api/v1/leads',
    description: 'Join waitlist — capture email for early access',
    category: 'System',
    params: '{ email: "user@example.com", source: "landing" }',
    example: 'curl -X POST https://tracker.aitradepulse.com/api/v1/leads -H "Content-Type: application/json" -d \'{"email":"user@example.com"}\'',
    response: '{ data: { success: true } }',
  },

  // ─── API Keys ──────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/keys',
    description: 'List API keys and tier configuration',
    category: 'System',
    example: 'curl https://tracker.aitradepulse.com/api/v1/keys',
    response: '{ data: { keys: [...], tiers: { free: { rateLimit: 100 }, pro: { rateLimit: 1000 } } } }',
  },
  {
    method: 'POST',
    path: '/api/v1/keys',
    description: 'Create new API key (free/pro/enterprise)',
    category: 'System',
    params: '{ name: "My Service", tier: "pro" }',
    example: 'curl -X POST https://tracker.aitradepulse.com/api/v1/keys -H "Content-Type: application/json" -d \'{"name":"My Service","tier":"pro"}\'',
    response: '{ data: { key: "nexus_abc123...", id: "abc123", tier: "pro", rateLimit: 1000 } }',
  },

  // ─── System ─────────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/health',
    description: 'System health check — all services',
    category: 'System',
    example: 'curl https://tracker.aitradepulse.com/api/v1/health',
    response: '{ status: "ok", checks: { redis: "ok", database: "ok", ws: "ok", entities: 2536 } }',
  },
  {
    method: 'GET',
    path: '/api/v1/status',
    description: 'System status and metrics',
    category: 'System',
    example: 'curl https://tracker.aitradepulse.com/api/v1/status',
  },
  {
    method: 'GET',
    path: '/api/v1/modules',
    description: 'List all available data modules (58 modules)',
    category: 'System',
    example: 'curl https://tracker.aitradepulse.com/api/v1/modules',
    response: '{ data: [{ id: "yahoo-finance", name: "Yahoo Finance", status: "active" }] }',
  },
]

const CATEGORIES = [...new Set(API_ENDPOINTS.map(e => e.category))]

export default function ApiDocsPage() {
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null)

  const filtered = selectedCategory === 'All'
    ? API_ENDPOINTS
    : API_ENDPOINTS.filter(e => e.category === selectedCategory)

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="page-title">API DOCUMENTATION</h1>
            <p className="text-xs text-text-muted mt-1">
              {API_ENDPOINTS.length} endpoints · REST API · JSON responses · No API key required for public endpoints
            </p>
          </div>
        </div>

        {/* Quick Start */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-semibold text-text-secondary mb-3">QUICK START</h2>
          <div className="space-y-2 text-xs text-text-dim font-mono">
            <p>Base URL: <span className="text-accent-cyan">https://tracker.aitradepulse.com</span></p>
            <p>All endpoints return JSON: <span className="text-accent-cyan">{`{ data: ..., error: null }`}</span></p>
            <p>No authentication required for public endpoints.</p>
            <p>Rate limit: 100 requests/day (free), 1,000/day (pro), 10,000/day (enterprise).</p>
          </div>
        </div>

        {/* Public API Pricing */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-semibold text-text-secondary mb-3">PUBLIC API PRICING</h2>
          <p className="text-xs text-text-dim mb-4">
            Need conviction scores in your app? Our Public API gives you programmatic access to real-time conviction data, backtest results, and macro indicators.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-bg-elevated rounded p-3 border border-border-dim">
              <div className="text-lg font-bold text-text-primary">FREE</div>
              <div className="text-xs text-text-muted mb-2">For testing &amp; evaluation</div>
              <ul className="text-xs text-text-dim space-y-1">
                <li>• 1,000 calls/month</li>
                <li>• Delayed conviction data</li>
                <li>• Basic market data</li>
                <li>• Community support</li>
              </ul>
            </div>
            <div className="bg-bg-elevated rounded p-3 border border-teal-vivid">
              <div className="text-lg font-bold text-text-primary">$49/mo</div>
              <div className="text-xs text-text-muted mb-2">Developer</div>
              <ul className="text-xs text-text-dim space-y-1">
                <li>• 100,000 calls/month</li>
                <li>• Real-time conviction</li>
                <li>• Backtest data</li>
                <li>• Webhook delivery</li>
                <li>• Email support</li>
              </ul>
            </div>
            <div className="bg-bg-elevated rounded p-3 border border-border-dim">
              <div className="text-lg font-bold text-text-primary">$199/mo</div>
              <div className="text-xs text-text-muted mb-2">Startup</div>
              <ul className="text-xs text-text-dim space-y-1">
                <li>• 1,000,000 calls/month</li>
                <li>• Real-time conviction</li>
                <li>• Full backtest history</li>
                <li>• Priority webhooks</li>
                <li>• Priority support</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-text-muted mt-3">
            Enterprise? <a href="mailto:support@aitradepulse.com" className="text-accent-cyan hover:underline">Contact us</a> for custom limits, SLA, and conviction data licensing.
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2">
          {['All', ...CATEGORIES].map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
                selectedCategory === cat
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {cat}
            </button>
          ))}
        </div>

        {/* Endpoints */}
        <div className="space-y-2">
          {filtered.map(ep => {
            const key = `${ep.method}-${ep.path}`
            const isExpanded = expandedEndpoint === key

            return (
              <div key={key}
                className={`bg-bg-panel border rounded-lg overflow-hidden transition-colors ${
                  isExpanded ? 'border-accent-cyan' : 'border-border-dim'
                }`}>
                <button
                  onClick={() => setExpandedEndpoint(isExpanded ? null : key)}
                  className="w-full p-3 flex items-center justify-between hover:bg-bg-elevated transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                      ep.method === 'GET' ? 'bg-data-bull/20 text-data-bull' :
                      ep.method === 'POST' ? 'bg-accent-cyan/20 text-accent-cyan' :
                      ep.method === 'DELETE' ? 'bg-data-bear/20 text-data-bear' :
                      'bg-bg-elevated text-text-muted'
                    }`}>
                      {ep.method}
                    </span>
                    <span className="text-xs font-mono text-text-primary">{ep.path}</span>
                  </div>
                  <span className="text-xs text-text-muted">{ep.description}</span>
                </button>

                {isExpanded && (
                  <div className="p-4 border-t border-border-dim space-y-3">
                    <p className="text-xs text-text-dim">{ep.description}</p>

                    {ep.params && (
                      <div>
                        <p className="text-xs text-accent-cyan mb-1">PARAMETERS</p>
                        <p className="text-xs text-text-dim bg-bg-elevated p-2 rounded">{ep.params}</p>
                      </div>
                    )}

                    {ep.example && (
                      <div>
                        <p className="text-xs text-accent-cyan mb-1">EXAMPLE</p>
                        <code className="text-xs font-mono text-text-dim bg-bg-elevated p-2 rounded block overflow-x-auto">
                          {ep.example}
                        </code>
                      </div>
                    )}

                    {ep.response && (
                      <div>
                        <p className="text-xs text-accent-cyan mb-1">RESPONSE</p>
                        <code className="text-xs font-mono text-text-dim bg-bg-elevated p-2 rounded block overflow-x-auto">
                          {ep.response}
                        </code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Integration Guide */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-semibold text-text-secondary mb-3">INTEGRATION GUIDE</h2>
          <div className="space-y-3 text-xs text-text-dim">
            <div>
              <p className="text-text-primary mb-1">1. Fetch Market Data</p>
              <code className="block bg-bg-elevated p-2 rounded font-mono">
                GET /api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=AAPL,BTC-USD
              </code>
            </div>
            <div>
              <p className="text-text-primary mb-1">2. Get OHLCV Candles</p>
              <code className="block bg-bg-elevated p-2 rounded font-mono">
                GET /api/v1/ohlcv?symbol=BTC-USD&interval=1d&range=1mo
              </code>
            </div>
            <div>
              <p className="text-text-primary mb-1">3. Stream Real-Time Data</p>
              <code className="block bg-bg-elevated p-2 rounded font-mono">
                WebSocket: wss://tracker.aitradepulse.com/socket.io/?EIO=4&transport=websocket
              </code>
            </div>
            <div>
              <p className="text-text-primary mb-1">4. Fetch DEX Pairs</p>
              <code className="block bg-bg-elevated p-2 rounded font-mono">
                GET /api/v1/dex/trending?network=solana
              </code>
            </div>
            <div>
              <p className="text-text-primary mb-1">5. Get Macro Data</p>
              <code className="block bg-bg-elevated p-2 rounded font-mono">
                GET /api/v1/macro (US) | GET /api/v1/indonesia-macro (Indonesia)
              </code>
            </div>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
