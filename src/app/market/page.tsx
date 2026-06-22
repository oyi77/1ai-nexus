"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { TrendingUp, TrendingDown, BarChart3, Globe, Activity } from "lucide-react"

interface Ticker {
  symbol: string
  price: string
  change: string
  positive: boolean
}

interface GlobalData {
  totalMarketCap: string
  totalVolume: string
  btcDominance: string
  ethDominance: string
  activeCryptos: number
}

interface FearGreedData {
  value: number
  classification: string
}

export default function MarketPage() {
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [global, setGlobal] = useState<GlobalData | null>(null)
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [priceRes, globalRes, fgRes] = await Promise.allSettled([
      fetch('/api/v1/market/prices').then(r => r.json()),
      fetch('/api/v1/modules/fetch?module=coingecko&action=global').then(r => r.json()),
      fetch('/api/v1/market/sentiment').then(r => r.json()),
    ])

    if (priceRes.status === 'fulfilled' && priceRes.value?.tickers) {
      setTickers(priceRes.value.tickers)
    }

    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      const d = globalRes.value.data as Record<string, unknown>
      const data = d.data as Record<string, unknown> | undefined
      if (data) {
        setGlobal({
          totalMarketCap: formatLargeNumber(data.total_market_cap as Record<string, number> | undefined),
          totalVolume: formatLargeNumber(data.total_volume as Record<string, number> | undefined),
          btcDominance: data.market_cap_percentage ? `${((data.market_cap_percentage as Record<string, number>).btc ?? 0).toFixed(1)}%` : '—',
          ethDominance: data.market_cap_percentage ? `${((data.market_cap_percentage as Record<string, number>).eth ?? 0).toFixed(1)}%` : '—',
          activeCryptos: (data.active_cryptocurrencies as number) ?? 0,
        })
      }
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
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
            <BarChart3 size={14} /> MARKET OVERVIEW
          </h1>
          <span className="text-[10px] text-text-muted">Live from CoinGecko + Binance</span>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatCard label="Total Market Cap" value={global?.totalMarketCap ?? '—'} icon={<Globe size={12} />} />
          <StatCard label="24h Volume" value={global?.totalVolume ?? '—'} icon={<Activity size={12} />} />
          <StatCard label="BTC Dominance" value={global?.btcDominance ?? '—'} icon={<BarChart3 size={12} />} />
          <StatCard label="ETH Dominance" value={global?.ethDominance ?? '—'} icon={<BarChart3 size={12} />} />
          <StatCard
            label="Fear & Greed"
            value={fearGreed ? `${fearGreed.value} ${fearGreed.classification}` : '—'}
            icon={<Activity size={12} />}
            color={fearGreed ? (fearGreed.value >= 55 ? 'text-accent-green' : fearGreed.value >= 45 ? 'text-accent-amber' : 'text-accent-red') : undefined}
          />
        </div>

        {/* Price Table */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim flex items-center gap-2">
            <span className="text-xs font-mono text-accent-cyan">LIVE PRICES</span>
            <span className="text-[10px] text-text-muted">{tickers.length} assets</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-text-dim text-xs">Loading market data...</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-[10px] uppercase">
                  <th className="text-left py-2 px-3 font-mono">#</th>
                  <th className="text-left py-2 px-3 font-mono">ASSET</th>
                  <th className="text-right py-2 px-3 font-mono">PRICE</th>
                  <th className="text-right py-2 px-3 font-mono">24H CHANGE</th>
                  <th className="text-right py-2 px-3 font-mono">SPARKLINE</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map((t, i) => (
                  <tr key={t.symbol} className="border-t border-border-dim/30 hover:bg-bg-elevated cursor-pointer">
                    <td className="py-2.5 px-3 text-text-muted">{i + 1}</td>
                    <td className="py-2.5 px-3">
                      <span className="font-mono text-text-primary font-bold">{t.symbol}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-text-primary">{t.price}</td>
                    <td className={`py-2.5 px-3 text-right font-mono ${t.positive ? 'text-accent-green' : 'text-accent-red'}`}>
                      <span className="flex items-center justify-end gap-1">
                        {t.positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {t.change}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`inline-block w-16 h-4 rounded ${t.positive ? 'bg-accent-green/20' : 'bg-accent-red/20'}`}>
                        <span className={`block h-full w-3/4 rounded ${t.positive ? 'bg-accent-green/40' : 'bg-accent-red/40'}`} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Data Sources */}
        <div className="bg-bg-panel border border-border-dim rounded p-3">
          <h3 className="text-xs font-mono text-accent-cyan mb-2">DATA SOURCES</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
            <div className="bg-bg-elevated rounded p-2">
              <p className="text-text-primary font-mono">CoinGecko</p>
              <p className="text-text-dim">18K+ coins, prices, market caps</p>
            </div>
            <div className="bg-bg-elevated rounded p-2">
              <p className="text-text-primary font-mono">Binance</p>
              <p className="text-text-dim">Spot + futures, order book, OHLCV</p>
            </div>
            <div className="bg-bg-elevated rounded p-2">
              <p className="text-text-primary font-mono">Fear & Greed</p>
              <p className="text-text-dim">Crypto sentiment index</p>
            </div>
            <div className="bg-bg-elevated rounded p-2">
              <p className="text-text-primary font-mono">DeFiLlama</p>
              <p className="text-text-dim">TVL, yields, stablecoins</p>
            </div>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color?: string }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-text-dim">{icon}</span>
        <span className="text-[10px] text-text-muted uppercase">{label}</span>
      </div>
      <p className={`text-sm font-mono font-bold ${color ?? 'text-text-primary'}`}>{value}</p>
    </div>
  )
}

function formatLargeNumber(data: Record<string, number> | undefined): string {
  if (!data) return '—'
  const usd = data.usd ?? 0
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`
  return `$${usd.toLocaleString()}`
}
