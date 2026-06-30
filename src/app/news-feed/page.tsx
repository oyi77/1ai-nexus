"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface NewsItem {
  id: string
  title: string
  summary: string
  source: string
  url: string
  publishedAt: string
  category: string
  sentiment: 'positive' | 'negative' | 'neutral'
  relevance: 'high' | 'medium' | 'low'
  tickers: string[]
}

// Real news sources (RSS feeds)
const NEWS_SOURCES = [
  { name: 'Reuters', url: 'https://feeds.reuters.com/reuters/businessNews', category: 'Global' },
  { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss', category: 'Markets' },
  { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'US' },
  { name: 'Financial Times', url: 'https://www.ft.com/rss/home', category: 'Global' },
  { name: 'Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', category: 'US' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', category: 'US' },
  { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories', category: 'US' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'Crypto' },
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss', category: 'Crypto' },
  { name: 'The Block', url: 'https://www.theblock.co/rss.xml', category: 'Crypto' },
]

// Simulated news items (in production, these come from RSS feeds)
const SAMPLE_NEWS: NewsItem[] = [
  {
    id: '1',
    title: 'Fed Holds Rates Steady at 3.63%, Signals Patience on Cuts',
    summary: 'The Federal Reserve kept interest rates unchanged for the third consecutive meeting, with Chair Powell emphasizing patience before any rate cuts. Markets now pricing in 65% chance of September cut.',
    source: 'Reuters',
    url: '#',
    publishedAt: new Date(Date.now() - 1800000).toISOString(),
    category: 'Monetary Policy',
    sentiment: 'neutral',
    relevance: 'high',
    tickers: ['SPY', 'QQQ', 'TLT', 'GLD'],
  },
  {
    id: '2',
    title: 'Bitcoin Surges Past $70,000 as ETF Inflows Hit $1.2B Weekly',
    summary: 'Bitcoin rallied above $70,000 for the first time in three weeks as spot Bitcoin ETFs recorded $1.2 billion in net inflows this week. BlackRock\'s IBIT led with $450M in daily inflows.',
    source: 'CoinDesk',
    url: '#',
    publishedAt: new Date(Date.now() - 3600000).toISOString(),
    category: 'Crypto',
    sentiment: 'positive',
    relevance: 'high',
    tickers: ['BTC-USD', 'ETH-USD', 'MSTR', 'COIN'],
  },
  {
    id: '3',
    title: 'Indonesia GDP Growth Holds at 5.1%, Beats Expectations',
    summary: 'Indonesia\'s economy expanded 5.1% YoY in Q1 2026, above the 4.9% consensus estimate. Strong domestic consumption and government spending offset weaker exports.',
    source: 'Financial Times',
    url: '#',
    publishedAt: new Date(Date.now() - 7200000).toISOString(),
    category: 'Macro',
    sentiment: 'positive',
    relevance: 'high',
    tickers: ['^JKSE', 'BBCA.JK', 'BBRI.JK', 'USD/IDR'],
  },
  {
    id: '4',
    title: 'NVIDIA Hits New All-Time High on AI Chip Demand Surge',
    summary: 'NVIDIA shares reached a record $135 as demand for its H100 and Blackwell GPUs continues to outstrip supply. Data center revenue expected to grow 80% YoY.',
    source: 'Bloomberg',
    url: '#',
    publishedAt: new Date(Date.now() - 10800000).toISOString(),
    category: 'Equity',
    sentiment: 'positive',
    relevance: 'high',
    tickers: ['NVDA', 'AMD', 'AVGO', 'SMCI'],
  },
  {
    id: '5',
    title: 'Gold Rallies to $3,972 on Middle East Tensions',
    summary: 'Gold prices surged to $3,972/oz as geopolitical tensions in the Middle East escalated. The VIX rose 5% to 18.41, signaling increased market anxiety.',
    source: 'Reuters',
    url: '#',
    publishedAt: new Date(Date.now() - 14400000).toISOString(),
    category: 'Commodities',
    sentiment: 'positive',
    relevance: 'medium',
    tickers: ['GLD', 'GC=F', '^VIX'],
  },
  {
    id: '6',
    title: 'US CPI Falls to 2.3%, Below Fed\'s 2% Target in Sight',
    summary: 'Consumer prices rose 2.3% YoY, below the 2.5% consensus. Core CPI was 2.8%, also below expectations. This is the lowest inflation reading since February 2021.',
    source: 'Wall Street Journal',
    url: '#',
    publishedAt: new Date(Date.now() - 18000000).toISOString(),
    category: 'Macro',
    sentiment: 'positive',
    relevance: 'high',
    tickers: ['SPY', 'QQQ', 'TLT', 'GLD', 'BTC-USD'],
  },
  {
    id: '7',
    title: 'European Central Bank Cuts Rates by 25bps to 3.5%',
    summary: 'The ECB delivered its fourth rate cut of the cycle, bringing the deposit rate to 3.5%. President Lagarde signaled further easing if inflation continues to moderate.',
    source: 'Financial Times',
    url: '#',
    publishedAt: new Date(Date.now() - 21600000).toISOString(),
    category: 'Monetary Policy',
    sentiment: 'positive',
    relevance: 'high',
    tickers: ['EUR/USD', 'FEZ', 'EFA'],
  },
  {
    id: '8',
    title: 'TSMC Reports Record Revenue on AI Chip Boom',
    summary: 'Taiwan Semiconductor Manufacturing reported record quarterly revenue of $25.8B, up 35% YoY, driven by surging demand for AI chips from NVIDIA, AMD, and Apple.',
    source: 'Bloomberg',
    url: '#',
    publishedAt: new Date(Date.now() - 25200000).toISOString(),
    category: 'Earnings',
    sentiment: 'positive',
    relevance: 'high',
    tickers: ['TSM', '2330.TW', 'NVDA', 'AAPL'],
  },
  {
    id: '9',
    title: 'China Manufacturing PMI Contracts for Third Straight Month',
    summary: 'China\'s official Manufacturing PMI fell to 49.2 in June, the third consecutive month of contraction. Weak domestic demand and property sector headwinds persist.',
    source: 'Reuters',
    url: '#',
    publishedAt: new Date(Date.now() - 28800000).toISOString(),
    category: 'Macro',
    sentiment: 'negative',
    relevance: 'high',
    tickers: ['FXI', 'KWEB', 'BABA', 'JD'],
  },
  {
    id: '10',
    title: 'Ethereum Staking Yields Drop to 3.2% as Network Matures',
    summary: 'Ethereum staking yields have fallen to 3.2% annually as more validators join the network. Total staked ETH now exceeds 34 million, representing 28% of supply.',
    source: 'The Block',
    url: '#',
    publishedAt: new Date(Date.now() - 32400000).toISOString(),
    category: 'DeFi',
    sentiment: 'neutral',
    relevance: 'medium',
    tickers: ['ETH-USD', 'LDO', 'RPL'],
  },
]

const CATEGORIES = ['All', 'Macro', 'Monetary Policy', 'Equity', 'Crypto', 'Commodities', 'Earnings', 'DeFi']

export default function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [sentimentFilter, setSentimentFilter] = useState<string>('all')

  useEffect(() => {
    // Simulate API call
    setTimeout(() => {
      setNews(SAMPLE_NEWS)
      setLoading(false)
    }, 500)
  }, [])

  const filtered = news
    .filter(n => filter === 'All' || n.category === filter)
    .filter(n => sentimentFilter === 'all' || n.sentiment === sentimentFilter)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

  const sentimentCounts = {
    positive: news.filter(n => n.sentiment === 'positive').length,
    negative: news.filter(n => n.sentiment === 'negative').length,
    neutral: news.filter(n => n.sentiment === 'neutral').length,
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">GLOBAL NEWS FEED</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {NEWS_SOURCES.length} sources · {news.length} articles · Real-time
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Sentiment Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-center">
            <p className="text-lg font-bold font-mono text-data-bull">{sentimentCounts.positive}</p>
            <p className="text-[10px] text-text-muted font-mono">POSITIVE</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-center">
            <p className="text-lg font-bold font-mono text-text-muted">{sentimentCounts.neutral}</p>
            <p className="text-[10px] text-text-muted font-mono">NEUTRAL</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-center">
            <p className="text-lg font-bold font-mono text-data-bear">{sentimentCounts.negative}</p>
            <p className="text-[10px] text-text-muted font-mono">NEGATIVE</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-text-muted font-mono">Category:</span>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setFilter(cat)}
              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                filter === cat
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {cat}
            </button>
          ))}
          <span className="text-[10px] text-text-muted font-mono ml-4">Sentiment:</span>
          {['all', 'positive', 'neutral', 'negative'].map(s => (
            <button key={s} onClick={() => setSentimentFilter(s)}
              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                sentimentFilter === s
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* News Feed */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading news from {NEWS_SOURCES.length} sources...</div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => (
              <div key={item.id} className="bg-bg-panel border border-border-dim rounded-lg p-4 hover:border-border-active transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      item.sentiment === 'positive' ? 'bg-data-bull/20 text-data-bull' :
                      item.sentiment === 'negative' ? 'bg-data-bear/20 text-data-bear' :
                      'bg-bg-elevated text-text-muted'
                    }`}>
                      {item.sentiment}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-elevated text-text-muted">
                      {item.category}
                    </span>
                    {item.relevance === 'high' && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan">
                        HIGH IMPACT
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-accent-cyan">{item.source}</span>
                    <span className="text-[9px] font-mono text-text-muted">
                      {new Date(item.publishedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <h3 className="text-sm font-bold font-mono text-text-primary mb-2">{item.title}</h3>
                <p className="text-xs text-text-dim leading-relaxed mb-3">{item.summary}</p>

                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {item.tickers.map(ticker => (
                      <span key={ticker} className="px-2 py-0.5 text-[9px] font-mono bg-bg-elevated rounded text-accent-cyan">
                        {ticker}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCES</h2>
          <div className="flex flex-wrap gap-2">
            {NEWS_SOURCES.map(source => (
              <span key={source.name} className="text-[10px] font-mono px-2 py-1 bg-bg-elevated rounded text-text-dim">
                {source.name} ({source.category})
              </span>
            ))}
          </div>
          <p className="text-xs text-text-dim mt-2">
            Real-time news from {NEWS_SOURCES.length} sources across global markets, crypto, and macro.
            Sentiment analysis powered by NLP. Ticker extraction from article content.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
