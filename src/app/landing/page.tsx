"use client"

import Link from 'next/link'

const features = [
  {
    icon: '🧠',
    title: 'AI-Powered Signals',
    description: 'Cross-correlated signals from trade flow, whale alerts, funding rates, and sentiment analysis.',
  },
  {
    icon: '📊',
    title: 'Trading Levels',
    description: 'Every signal includes Entry, TP1, TP2, TP3, and Stop Loss — calculated from real volatility.',
  },
  {
    icon: '⏱️',
    title: 'Valid Periods',
    description: 'Signals have expiration times (4h/24h/7d) based on strength and source.',
  },
  {
    icon: '📈',
    title: 'Backtested',
    description: 'Historical accuracy tracked and verified. Win rate, profit factor, max drawdown.',
  },
  {
    icon: '🎯',
    title: 'Risk Management',
    description: 'Position sizing calculator, R:R ratio display, drawdown protection.',
  },
  {
    icon: '🔌',
    title: 'API Access',
    description: 'RESTful API with authentication, rate limiting, and usage tracking.',
  },
]

const stats = [
  { value: '30+', label: 'Active Signals' },
  { value: '30+', label: 'Data Sources' },
  { value: '24/7', label: 'Monitoring' },
  { value: '<1s', label: 'Latency' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-vivid/10 to-bg-base" />
        <div className="relative max-w-6xl mx-auto px-6 py-24">
          <nav className="flex items-center justify-between mb-16">
            <div className="flex items-center gap-2">
              <span className="text-2xl">◈</span>
              <span className="text-xl font-bold font-mono text-text-primary">NEXUS</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="text-sm font-mono text-text-muted hover:text-text-primary transition-colors">
                Pricing
              </Link>
              <Link href="/terms" className="text-sm font-mono text-text-muted hover:text-text-primary transition-colors">
                Terms
              </Link>
              <Link
                href="/alpha-engine"
                className="px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold text-sm rounded hover:bg-teal-vivid/80 transition-colors"
              >
                Launch App
              </Link>
            </div>
          </nav>

          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-5xl font-bold font-mono text-text-primary mb-6">
              Alpha Signals for{' '}
              <span className="text-teal-vivid">Crypto Trading</span>
            </h1>
            <p className="text-lg text-text-secondary font-mono mb-8">
              AI-powered trading signals with Entry, Take Profit, and Stop Loss levels.
              Cross-correlated from trade flow, whale alerts, funding rates, and sentiment.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link
                href="/pricing"
                className="px-8 py-3 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
              >
                Get Started Free
              </Link>
              <Link
                href="/alpha-engine"
                className="px-8 py-3 bg-bg-raised text-text-primary font-mono font-bold rounded hover:bg-bg-elevated transition-colors"
              >
                View Live Signals
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Promo Video */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="relative rounded-xl overflow-hidden border border-border-dim shadow-2xl shadow-teal-vivid/10">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full"
            poster="/promo-hero.jpg"
          >
            <source src="/promo-video.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-t from-bg-base/80 via-transparent to-transparent" />
          <div className="absolute bottom-6 left-6 right-6 text-center">
            <p className="text-sm font-mono text-text-muted">
              AI-powered signals • Real-time data • Professional grade
            </p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border-dim">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl font-bold font-mono text-teal-vivid">{stat.value}</p>
                <p className="text-sm text-text-muted font-mono mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold font-mono text-text-primary mb-4">
            Everything You Need to Trade Smarter
          </h2>
          <p className="text-text-secondary font-mono max-w-2xl mx-auto">
            Our alpha engine combines multiple data sources to generate high-confidence trading signals
            with precise entry and exit levels.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-8">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="p-6 bg-bg-panel border border-border-dim rounded-lg hover:border-teal-vivid/50 transition-colors"
            >
              <span className="text-3xl mb-4 block">{feature.icon}</span>
              <h3 className="text-lg font-bold font-mono text-text-primary mb-2">{feature.title}</h3>
              <p className="text-sm text-text-secondary">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Data Sources */}
      <section className="border-y border-border-dim bg-bg-panel/50">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold font-mono text-text-primary mb-4">
              30+ Data Sources
            </h2>
            <p className="text-text-secondary font-mono">
              Cross-correlated from the best free and premium data providers
            </p>
          </div>

          <div className="grid grid-cols-4 md:grid-cols-6 gap-4">
            {[
              // Exchanges (Real-time WebSocket)
              { name: 'Binance', cat: 'Exchange' },
              { name: 'OKX', cat: 'Exchange' },
              { name: 'Bybit', cat: 'Exchange' },
              { name: 'Bitfinex', cat: 'Exchange' },
              { name: 'Kraken', cat: 'Exchange' },
              { name: 'Gate.io', cat: 'Exchange' },
              { name: 'Indodax', cat: 'Exchange' },
              // Market Data
              { name: 'CoinGecko', cat: 'Market' },
              { name: 'CoinPaprika', cat: 'Market' },
              { name: 'Yahoo Finance', cat: 'Equities' },
              { name: 'ExchangeRate', cat: 'Forex' },
              // Blockchain
              { name: 'DeFiLlama', cat: 'DeFi' },
              { name: 'DexScreener', cat: 'DEX' },
              { name: 'GeckoTerminal', cat: 'DEX' },
              { name: 'Blockstream', cat: 'Bitcoin' },
              { name: 'Mempool', cat: 'Bitcoin' },
              { name: 'Beaconcha.in', cat: 'Ethereum' },
              { name: 'Alchemy', cat: 'RPC' },
              { name: 'Helius', cat: 'Solana' },
              { name: 'Etherscan', cat: 'Explorer' },
              // Analytics
              { name: 'Deribit', cat: 'Options' },
              { name: 'Polymarket', cat: 'Predictions' },
              { name: 'Reservoir', cat: 'NFT' },
              // Macro
              { name: 'FRED', cat: 'Macro' },
              { name: 'SEC EDGAR', cat: 'Filings' },
              // News/Sentiment
              { name: 'RSS Feeds', cat: 'News' },
              { name: 'GDELT', cat: 'News' },
              { name: 'Fear & Greed', cat: 'Sentiment' },
            ].map((src) => (
              <div key={src.name} className="text-center p-3 bg-bg-base rounded-lg border border-border-dim">
                <p className="text-xs font-mono font-bold text-text-primary">{src.name}</p>
                <p className="text-[10px] text-text-muted font-mono">{src.cat}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample Signal */}
      <section className="border-y border-border-dim">
        <div className="max-w-4xl mx-auto px-6 py-24">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold font-mono text-text-primary mb-4">
              Live Signal Example
            </h2>
            <p className="text-text-secondary font-mono">
              Every signal includes actionable trading levels
            </p>
          </div>

          <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🟢</span>
              <span className="text-xl font-bold font-mono text-data-bull">BTC LONG</span>
              <span className="px-2 py-1 bg-data-bull/20 text-data-bull text-xs font-mono rounded">
                STRENGTH: 85
              </span>
              <span className="px-2 py-1 bg-data-bull/20 text-data-bull text-xs font-mono rounded">
                CONF: 70%
              </span>
              <span className="px-2 py-1 bg-data-bull/20 text-data-bull text-xs font-mono rounded">
                R:R 2.1:1
              </span>
            </div>

            <div className="grid grid-cols-5 gap-4 mb-4">
              <div>
                <p className="text-xs text-text-muted font-mono">ENTRY</p>
                <p className="text-lg font-bold font-mono text-text-primary">$61,248</p>
              </div>
              <div>
                <p className="text-xs text-data-bull font-mono">TP1</p>
                <p className="text-lg font-bold font-mono text-data-bull">$62,803</p>
              </div>
              <div>
                <p className="text-xs text-data-bull font-mono">TP2</p>
                <p className="text-lg font-bold font-mono text-data-bull">$64,359</p>
              </div>
              <div>
                <p className="text-xs text-data-bull font-mono">TP3</p>
                <p className="text-lg font-bold font-mono text-data-bull">$65,915</p>
              </div>
              <div>
                <p className="text-xs text-data-bear font-mono">STOP LOSS</p>
                <p className="text-lg font-bold font-mono text-data-bear">$58,914</p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-text-muted font-mono">
              <span>Source: whale-alert, funding-rate</span>
              <span>•</span>
              <span>Valid: 7 days</span>
              <span>•</span>
              <span>Risk: 3.8%</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h2 className="text-3xl font-bold font-mono text-text-primary mb-4">
          Ready to Trade Smarter?
        </h2>
        <p className="text-text-secondary font-mono mb-8 max-w-xl mx-auto">
          Start with our free tier. No credit card required. 14-day trial for Pro features.
        </p>
        <Link
          href="/pricing"
          className="inline-block px-8 py-3 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
        >
          View Pricing Plans
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-dim">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">◈</span>
              <span className="text-lg font-bold font-mono text-text-primary">NEXUS</span>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/terms" className="text-sm text-text-muted font-mono hover:text-text-primary transition-colors">
                Terms of Service
              </Link>
              <Link href="/pricing" className="text-sm text-text-muted font-mono hover:text-text-primary transition-colors">
                Pricing
              </Link>
              <Link href="/alpha-engine" className="text-sm text-text-muted font-mono hover:text-text-primary transition-colors">
                Alpha Engine
              </Link>
            </div>
          </div>
          <p className="text-xs text-text-muted font-mono mt-4">
            © {new Date().getFullYear()} NEXUS Intelligence Terminal. Not financial advice.
          </p>
        </div>
      </footer>
    </div>
  )
}
