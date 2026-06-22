"use client"

import { useState, useEffect, useCallback } from "react"
import { TrendingUp, TrendingDown, Layers, Globe } from "lucide-react"

interface Ticker {
  symbol: string
  price: string
  change: string
  positive: boolean
}

interface NewsItem {
  id: string
  title: string
  sourceId: string
  publishedAt: string
  category: string
}

interface DeFiProtocol {
  name: string
  chain: string
  tvl: number
  change_1d?: number
}

export function TerminalContent() {
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [defi, setDeFi] = useState<DeFiProtocol[]>([])
  const [fearGreed, setFearGreed] = useState<{ value: number; classification: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [priceRes, newsRes, defiRes, fgRes] = await Promise.allSettled([
      fetch('/api/v1/market/prices').then(r => r.json()),
      fetch('/api/v1/news?limit=15').then(r => r.json()),
      fetch('/api/v1/modules/fetch?module=defillama&action=protocols').then(r => r.json()),
      fetch('/api/v1/market/sentiment').then(r => r.json()),
    ])

    if (priceRes.status === 'fulfilled' && priceRes.value?.tickers) {
      setTickers(priceRes.value.tickers)
    }
    if (newsRes.status === 'fulfilled' && newsRes.value?.items) {
      setNews(newsRes.value.items)
    }
    if (defiRes.status === 'fulfilled' && defiRes.value?.data) {
      const protocols = (defiRes.value.data as Array<Record<string, unknown>>)
        .sort((a, b) => ((b.tvl as number) ?? 0) - ((a.tvl as number) ?? 0))
        .slice(0, 15)
        .map(p => ({
          name: p.name as string ?? 'Unknown',
          chain: p.chain as string ?? '—',
          tvl: p.tvl as number ?? 0,
          change_1d: p.change_1d as number ?? 0,
        }))
      setDeFi(protocols)
    }
    if (fgRes.status === 'fulfilled' && fgRes.value?.fearGreed != null) {
      setFearGreed({ value: fgRes.value.fearGreed, classification: fgRes.value.classification })
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    const invoke = () => fetchData()
    invoke()
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Market Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {tickers.map(t => (
          <div key={t.symbol} className="bg-bg-panel border border-border-dim rounded p-2.5">
            <p className="text-[10px] text-text-muted font-mono">{t.symbol}</p>
            <p className="text-sm font-mono font-bold text-text-primary">{t.price}</p>
            <p className={`text-[11px] font-mono ${t.positive ? 'text-accent-green' : 'text-accent-red'}`}>
              {t.positive ? <TrendingUp size={10} className="inline" /> : <TrendingDown size={10} className="inline" />}
              {' '}{t.change}
            </p>
          </div>
        ))}
      </div>

      {/* Fear & Greed + Global Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-bg-panel border border-border-dim rounded p-3">
          <p className="text-[10px] text-text-muted uppercase mb-1">Fear & Greed Index</p>
          {fearGreed ? (
            <div className="flex items-center gap-3">
              <span className="text-3xl font-mono font-bold" style={{
                color: fearGreed.value >= 55 ? '#00ff88' : fearGreed.value >= 45 ? '#ffb800' : '#ff3060'
              }}>
                {fearGreed.value}
              </span>
              <span className="text-xs text-text-dim">{fearGreed.classification}</span>
            </div>
          ) : (
            <span className="text-text-dim text-xs">Loading...</span>
          )}
        </div>
        <div className="bg-bg-panel border border-border-dim rounded p-3">
          <p className="text-[10px] text-text-muted uppercase mb-1">Active Data Modules</p>
          <p className="text-2xl font-mono font-bold text-accent-cyan">34</p>
          <p className="text-[10px] text-text-dim">20 public-api · 1 oss-mirror · 11 re · 4 derived</p>
        </div>
        <div className="bg-bg-panel border border-border-dim rounded p-3">
          <p className="text-[10px] text-text-muted uppercase mb-1">Data Sources</p>
          <p className="text-2xl font-mono font-bold text-accent-green">100%</p>
          <p className="text-[10px] text-text-dim">Zero API keys required</p>
        </div>
      </div>

      {/* Two-column: News + DeFi */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Latest News */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim flex items-center gap-2">
            <span className="text-xs font-mono text-accent-cyan">📰 LATEST NEWS</span>
            <span className="text-[10px] text-text-muted">{news.length} items</span>
          </div>
          <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="p-4 text-text-dim text-xs text-center">Loading news feed...</div>
            ) : news.length === 0 ? (
              <div className="p-4 text-text-dim text-xs text-center">No news available</div>
            ) : (
              news.map((item, i) => (
                <div key={item.id ?? i} className="px-3 py-2 border-b border-border-dim/30 hover:bg-bg-elevated transition-colors">
                  <p className="text-xs text-text-primary leading-tight">{item.title || 'Untitled'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-accent-cyan font-mono">{item.sourceId}</span>
                    <span className="text-[10px] text-text-muted">{formatTimeAgo(item.publishedAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top DeFi Protocols */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim flex items-center gap-2">
            <Layers size={12} className="text-accent-cyan" />
            <span className="text-xs font-mono text-accent-cyan">TOP DeFi BY TVL</span>
            <span className="text-[10px] text-text-muted">{defi.length} protocols</span>
          </div>
          <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="p-4 text-text-dim text-xs text-center">Loading DeFi data...</div>
            ) : defi.length === 0 ? (
              <div className="p-4 text-text-dim text-xs text-center">No DeFi data available</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted">
                    <th className="text-left py-1.5 px-3 font-mono">#</th>
                    <th className="text-left py-1.5 px-3 font-mono">PROTOCOL</th>
                    <th className="text-left py-1.5 px-3 font-mono">CHAIN</th>
                    <th className="text-right py-1.5 px-3 font-mono">TVL</th>
                    <th className="text-right py-1.5 px-3 font-mono">1D</th>
                  </tr>
                </thead>
                <tbody>
                  {defi.map((p, i) => (
                    <tr key={p.name} className="border-t border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-1.5 px-3 text-text-muted">{i + 1}</td>
                      <td className="py-1.5 px-3 text-text-primary font-mono">{p.name}</td>
                      <td className="py-1.5 px-3 text-accent-cyan">{p.chain}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-accent-green">${formatTvl(p.tvl)}</td>
                      <td className={`py-1.5 px-3 text-right font-mono ${(p.change_1d ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        {p.change_1d != null ? `${p.change_1d >= 0 ? '+' : ''}${p.change_1d.toFixed(2)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Global Stats Bar */}
      <div className="bg-bg-panel border border-border-dim rounded p-3">
        <div className="flex items-center gap-2 mb-2">
          <Globe size={12} className="text-accent-cyan" />
          <span className="text-xs font-mono text-accent-cyan">MODULE STATUS</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-text-muted">On-chain</p>
            <p className="font-mono text-accent-green">6 modules active</p>
          </div>
          <div>
            <p className="text-text-muted">Market</p>
            <p className="font-mono text-accent-green">5 modules active</p>
          </div>
          <div>
            <p className="text-text-muted">Macro</p>
            <p className="font-mono text-accent-green">7 modules active</p>
          </div>
          <div>
            <p className="text-text-muted">News</p>
            <p className="font-mono text-accent-green">4 modules active</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTvl(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toFixed(0)
}

function formatTimeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  } catch {
    // Expected: malformed ISO strings return fallback display
    return '—'
  }
}
