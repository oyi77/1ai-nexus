"use client"

import { useState, useEffect, useCallback } from "react"
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Globe,
  Newspaper,
  Layers,
  Activity,
} from "lucide-react"

interface MarketCard {
  symbol: string
  name: string
  price: string
  change24h: string
  positive: boolean
  volume: string
  marketCap: string
}

interface NewsItem {
  id: string
  title: string
  source: string
  publishedAt: string
  category: string
}

export function TerminalContent() {
  const [marketData, setMarketData] = useState<MarketCard[]>([])
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [activeView, setActiveView] = useState<'overview' | 'market' | 'defi' | 'news'>('overview')
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [priceRes, newsRes] = await Promise.allSettled([
        fetch('/api/v1/market/prices').then(r => r.json()),
        fetch('/api/v1/news?limit=20').then(r => r.json()),
      ])

      if (priceRes.status === 'fulfilled' && priceRes.value?.tickers) {
        setMarketData(priceRes.value.tickers.map((t: { symbol: string; price: string; change: string; positive: boolean }) => ({
          symbol: t.symbol,
          name: t.symbol,
          price: t.price,
          change24h: t.change,
          positive: t.positive,
          volume: '—',
          marketCap: '—',
        })))
      }

      if (newsRes.status === 'fulfilled' && newsRes.value?.items) {
        setNewsItems(newsRes.value.items)
      }
    } catch {
      // Silent fallback
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  return (
    <div className="h-full flex flex-col">
      {/* View tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border-dim">
        {[
          { key: 'overview', label: 'OVERVIEW', icon: Activity },
          { key: 'market', label: 'MARKET', icon: TrendingUp },
          { key: 'defi', label: 'DEFI', icon: Layers },
          { key: 'news', label: 'NEWS', icon: Newspaper },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveView(key as typeof activeView)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono transition-colors ${
              activeView === key
                ? 'bg-border-active text-text-primary'
                : 'text-text-dim hover:text-text-primary hover:bg-bg-elevated'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {activeView === 'overview' && (
          <OverviewPanel marketData={marketData} newsItems={newsItems} loading={loading} />
        )}
        {activeView === 'market' && (
          <MarketPanel marketData={marketData} loading={loading} />
        )}
        {activeView === 'defi' && (
          <DeFiPanel />
        )}
        {activeView === 'news' && (
          <NewsPanel newsItems={newsItems} loading={loading} />
        )}
      </div>
    </div>
  )
}

function OverviewPanel({ marketData, newsItems, loading }: { marketData: MarketCard[]; newsItems: NewsItem[]; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Market Summary */}
      <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
        <h3 className="text-xs font-mono text-accent-cyan mb-3 flex items-center gap-2">
          <BarChart3 size={14} /> MARKET SUMMARY
        </h3>
        {loading ? (
          <div className="text-text-dim text-xs">Loading...</div>
        ) : (
          <div className="space-y-2">
            {marketData.map(item => (
              <div key={item.symbol} className="flex items-center justify-between py-1 border-b border-border-dim/30">
                <span className="font-mono text-sm text-text-primary">{item.symbol}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">{item.price}</span>
                  <span className={`font-mono text-xs ${item.positive ? 'text-accent-green' : 'text-accent-red'}`}>
                    {item.positive ? <TrendingUp size={10} className="inline" /> : <TrendingDown size={10} className="inline" />}
                    {' '}{item.change24h}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Latest News */}
      <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
        <h3 className="text-xs font-mono text-accent-cyan mb-3 flex items-center gap-2">
          <Newspaper size={14} /> LATEST NEWS
        </h3>
        {loading ? (
          <div className="text-text-dim text-xs">Loading...</div>
        ) : (
          <div className="space-y-2">
            {newsItems.slice(0, 8).map(item => (
              <div key={item.id} className="py-1 border-b border-border-dim/30">
                <p className="text-xs text-text-primary leading-tight">{item.title}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{item.source}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DeFi Overview */}
      <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
        <h3 className="text-xs font-mono text-accent-cyan mb-3 flex items-center gap-2">
          <Layers size={14} /> DEFI OVERVIEW
        </h3>
        <div className="text-text-dim text-xs">
          <p>Loading DeFi data from DeFiLlama...</p>
        </div>
      </div>

      {/* Global Stats */}
      <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
        <h3 className="text-xs font-mono text-accent-cyan mb-3 flex items-center gap-2">
          <Globe size={14} /> GLOBAL STATS
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Market Cap', value: '—' },
            { label: '24h Volume', value: '—' },
            { label: 'BTC Dominance', value: '—' },
            { label: 'Active Modules', value: '16' },
          ].map(stat => (
            <div key={stat.label}>
              <p className="text-[10px] text-text-muted uppercase">{stat.label}</p>
              <p className="text-sm font-mono text-text-primary">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MarketPanel({ marketData, loading }: { marketData: MarketCard[]; loading: boolean }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
      <h3 className="text-xs font-mono text-accent-cyan mb-3">MARKET DATA</h3>
      {loading ? (
        <div className="text-text-dim text-xs">Loading market data...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted border-b border-border-dim">
                <th className="text-left py-2 font-mono">SYMBOL</th>
                <th className="text-right py-2 font-mono">PRICE</th>
                <th className="text-right py-2 font-mono">24H CHANGE</th>
              </tr>
            </thead>
            <tbody>
              {marketData.map(item => (
                <tr key={item.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                  <td className="py-2 font-mono text-text-primary">{item.symbol}</td>
                  <td className="py-2 text-right font-mono">{item.price}</td>
                  <td className={`py-2 text-right font-mono ${item.positive ? 'text-accent-green' : 'text-accent-red'}`}>
                    {item.change24h}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DeFiPanel() {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
      <h3 className="text-xs font-mono text-accent-cyan mb-3">DEFI PROTOCOLS</h3>
      <div className="text-text-dim text-xs">
        <p>DeFi data from DeFiLlama module loading...</p>
        <p className="mt-2 text-text-muted">TVL, yields, stablecoins, and bridge data available via ModuleRegistry</p>
      </div>
    </div>
  )
}

function NewsPanel({ newsItems, loading }: { newsItems: NewsItem[]; loading: boolean }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
      <h3 className="text-xs font-mono text-accent-cyan mb-3">NEWS FEED</h3>
      {loading ? (
        <div className="text-text-dim text-xs">Loading news...</div>
      ) : (
        <div className="space-y-3">
          {newsItems.map(item => (
            <div key={item.id} className="py-2 border-b border-border-dim/30">
              <p className="text-sm text-text-primary">{item.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-accent-cyan font-mono">{item.source}</span>
                <span className="text-[10px] text-text-muted">{formatDate(item.publishedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}
