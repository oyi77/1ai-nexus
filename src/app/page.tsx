"use client"

import { useState, useEffect, useCallback } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { Sparkline } from "@/components/terminal/charts/Sparkline"
import { TrendingUp, TrendingDown, Layers, Newspaper } from "lucide-react"

interface Ticker {
  symbol: string
  price: string
  change: string
  positive: boolean
  sparkline?: number[]
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
  change_1d: unknown
}

interface TrendingToken {
  symbol: string
  network: string
  volume24h: number
  change24h: number
  rugScore: number
}

export default function TerminalPage() {
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [defi, setDeFi] = useState<DeFiProtocol[]>([])
  const [tokens, setTokens] = useState<TrendingToken[]>([])
  const [fearGreed, setFearGreed] = useState<{ value: number; classification: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [priceRes, newsRes, defiRes, tokenRes, fgRes] = await Promise.allSettled([
      fetch('/api/v1/market/prices').then(r => r.json()),
      fetch('/api/v1/news?limit=20').then(r => r.json()),
      fetch('/api/v1/defi/tvl?limit=10').then(r => r.json()),
      fetch('/api/v1/tokens/discover?limit=10').then(r => r.json()),
      fetch('/api/v1/market/sentiment').then(r => r.json()),
    ])

    if (priceRes.status === 'fulfilled' && priceRes.value?.tickers) {
      setTickers(priceRes.value.tickers.map((t: Record<string, unknown>) => ({
        ...t,
        sparkline: generateSparkline(),
      })))
    }
    if (newsRes.status === 'fulfilled' && newsRes.value?.items) setNews(newsRes.value.items)
    if (defiRes.status === 'fulfilled' && defiRes.value?.protocols) setDeFi(defiRes.value.protocols)
    if (tokenRes.status === 'fulfilled' && tokenRes.value?.tokens) setTokens(tokenRes.value.tokens)
    if (fgRes.status === 'fulfilled' && fgRes.value?.fearGreed != null) setFearGreed(fgRes.value)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  const fgColor = fearGreed ? (fearGreed.value >= 55 ? 'text-accent-green' : fearGreed.value >= 45 ? 'text-accent-amber' : 'text-accent-red') : 'text-text-dim'

  return (
    <TerminalShell>
      <div className="h-full overflow-auto p-2">
        {/* Bloomberg 4-Quadrant Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border-dim" style={{ minHeight: 'calc(100vh - 120px)' }}>
          {/* Top-Left: Market Quotes */}
          <div className="bg-bg-deep p-2 overflow-auto">
            <div className="text-[10px] font-mono text-accent-cyan mb-1 flex items-center gap-1">
              <TrendingUp size={10} /> MARKET QUOTES
              {fearGreed && (
                <span className="ml-auto">
                  FG: <span className={fgColor}>{fearGreed.value} {fearGreed.classification}</span>
                </span>
              )}
            </div>
            {loading ? (
              <div className="text-text-dim text-[10px]">Loading...</div>
            ) : (
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-text-muted">
                    <th className="text-left text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">SYM</th>
                    <th className="text-right text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">PRICE</th>
                    <th className="text-right text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">CHG</th>
                    <th className="text-right text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">CHART</th>
                  </tr>
                </thead>
                <tbody>
                  {tickers.map(t => (
                    <tr key={t.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-0.5 px-2 font-mono font-bold text-[11px] text-text-primary">{t.symbol}</td>
                      <td className="py-0.5 px-2 text-right font-mono text-[11px]">{t.price}</td>
                      <td className={`py-0.5 px-2 text-right font-mono text-[11px] ${t.positive ? 'text-accent-green' : 'text-accent-red'}`}>
                        {t.positive ? '▲' : '▼'} {t.change}
                      </td>
                      <td className="py-0.5 px-2 text-right">
                        {t.sparkline && <Sparkline data={t.sparkline} width={80} height={16} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Top-Right: Chart + DeFi */}
          <div className="bg-bg-deep p-2 overflow-auto">
            <div className="text-[10px] font-mono text-accent-cyan mb-1 flex items-center gap-1">
              <Layers size={10} /> TOP DeFi BY TVL
            </div>
            {loading ? (
              <div className="text-text-dim text-[10px]">Loading...</div>
            ) : (
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-text-muted">
                    <th className="text-left text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">#</th>
                    <th className="text-left text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">PROTOCOL</th>
                    <th className="text-left text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">CHAIN</th>
                    <th className="text-right text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">TVL</th>
                    <th className="text-right text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">1D</th>
                  </tr>
                </thead>
                <tbody>
                  {defi.slice(0, 8).map((p, i) => (
                    <tr key={p.name + i} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-0.5 px-2 text-text-muted text-[10px]">{i + 1}</td>
                      <td className="py-0.5 px-2 font-mono text-[11px] text-text-primary">{p.name}</td>
                      <td className="py-0.5 px-2 text-[10px] text-accent-cyan">{p.chain}</td>
                      <td className="py-0.5 px-2 text-right font-mono text-[11px] text-accent-green">${formatTvl(Number(p.tvl))}</td>
                      <td className={`py-0.5 px-2 text-right font-mono text-[10px] ${Number(p.change_1d) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        {formatChange(p.change_1d)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Bottom-Left: News Feed */}
          <div className="bg-bg-deep p-2 overflow-auto">
            <div className="text-[10px] font-mono text-accent-cyan mb-1 flex items-center gap-1">
              <Newspaper size={10} /> LIVE NEWS ({news.length})
            </div>
            <div className="space-y-0.5">
              {news.slice(0, 15).map(item => (
                <div key={item.id} className="py-1 border-b border-border-dim/20 hover:bg-bg-elevated cursor-pointer">
                  <p className="text-[11px] text-text-primary leading-tight">{item.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] text-accent-cyan font-mono">{item.sourceId}</span>
                    <span className="text-[9px] text-text-muted">{formatTimeAgo(item.publishedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom-Right: Trending Tokens */}
          <div className="bg-bg-deep p-2 overflow-auto">
            <div className="text-[10px] font-mono text-accent-cyan mb-1">TRENDING TOKENS</div>
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-text-muted">
                  <th className="text-left text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">SYM</th>
                  <th className="text-left text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">CHAIN</th>
                  <th className="text-right text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">VOL</th>
                  <th className="text-right text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">CHG</th>
                  <th className="text-center text-[10px] font-mono font-normal px-2 py-0.5 border-b border-border-dim">RUG</th>
                </tr>
              </thead>
              <tbody>
                {tokens.slice(0, 10).map((t, i) => (
                  <tr key={t.symbol + i} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                    <td className="py-0.5 px-2 font-mono font-bold text-[11px] text-text-primary">{t.symbol}</td>
                    <td className="py-0.5 px-2 text-[10px] text-accent-cyan">{t.network.toUpperCase()}</td>
                    <td className="py-0.5 px-2 text-right font-mono text-[10px]">${formatNum(t.volume24h)}</td>
                    <td className={`py-0.5 px-2 text-right font-mono text-[10px] ${t.change24h >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {t.change24h >= 0 ? '▲' : '▼'} {Math.abs(t.change24h).toFixed(1)}%
                    </td>
                    <td className="py-0.5 px-2 text-center">
                      <span className={`font-mono text-[10px] ${t.rugScore >= 70 ? 'text-accent-red' : t.rugScore >= 40 ? 'text-accent-amber' : 'text-accent-green'}`}>
                        {t.rugScore}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </TerminalShell>
  )
}

function formatTvl(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n.toFixed(0)
}

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toFixed(0)
}

function formatChange(v: unknown): string {
  const n = Number(v)
  if (isNaN(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function formatTimeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  } catch { return '—' }
}

function generateSparkline(): number[] {
  const data: number[] = []
  let v = 100 + Math.random() * 50
  for (let i = 0; i < 20; i++) {
    v += (Math.random() - 0.48) * 5
    data.push(v)
  }
  return data
}
