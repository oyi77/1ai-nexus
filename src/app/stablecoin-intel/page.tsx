"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface StablecoinData {
  symbol: string
  name: string
  marketCap: number
  change24h: number
}

interface IntelResult {
  coins: StablecoinData[]
  totalSupply: number
  totalMarketCap: number
  dominance: number
  supplyChange24h: number
  ssr: number | null
  signal: 'risk-on' | 'risk-off' | 'neutral'
  signalReason: string
}

interface HistoryPoint {
  marketCap: number
  dominance: number | null
  change24h: number | null
  timestamp: string
}

interface ApiResponse {
  intel?: IntelResult
  history?: HistoryPoint[]
}

const COIN_COLORS: Record<string, string> = {
  USDT: '#26a17b',
  USDC: '#2775ca',
  DAI: '#f5ac37',
  FDUSD: '#3b82f6',
  TUSD: '#00bfff',
}

function fmtB(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

function fmtChange(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export default function StablecoinIntelPage() {
  const [intel, setIntel] = useState<IntelResult | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/stablecoin-intel?action=all')
        const json = await res.json()
        const data: ApiResponse = json?.data ?? {}
        if (data.intel) setIntel(data.intel)
        if (data.history) setHistory(data.history)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [])

  const signalColor = intel?.signal === 'risk-on'
    ? 'text-data-bull'
    : intel?.signal === 'risk-off'
      ? 'text-data-bear'
      : 'text-text-muted'

  const signalBg = intel?.signal === 'risk-on'
    ? 'border-data-bull/30 bg-data-bull/5'
    : intel?.signal === 'risk-off'
      ? 'border-data-bear/30 bg-data-bear/5'
      : 'border-border-dim bg-bg-panel'

  // Compute stacked area chart data from history
  const chartData = history.map((h) => ({
    time: new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    total: h.marketCap / 1e9,
    dominance: h.dominance ?? 0,
  }))

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan flex items-center gap-2">
              <DollarSign size={20} /> STABLECOIN INTELLIGENCE
            </h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Supply dynamics, dominance, and mint/burn tracking. The blood supply of crypto.
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Summary Strip */}
        {intel && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">TOTAL SUPPLY</p>
              <p className="text-lg font-mono font-bold text-teal-vivid">{fmtB(intel.totalSupply)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">DOMINANCE</p>
              <p className="text-lg font-mono font-bold">{intel.dominance.toFixed(2)}%</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">SUPPLY CHANGE 24H</p>
              <p className={`text-lg font-mono font-bold ${intel.supplyChange24h >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                {intel.supplyChange24h >= 0 ? '+' : ''}{fmtB(intel.supplyChange24h)}
              </p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">SSR (BTC/STABLES)</p>
              <p className="text-lg font-mono font-bold">{intel.ssr ? intel.ssr.toFixed(2) : '—'}</p>
            </div>
            <div className={`rounded-lg p-3 border ${signalBg}`}>
              <p className="text-[10px] text-text-muted font-mono">SIGNAL</p>
              <p className={`text-lg font-mono font-bold uppercase ${signalColor}`}>
                {intel.signal === 'risk-on' ? '🟢 RISK-ON' : intel.signal === 'risk-off' ? '🔴 RISK-OFF' : '⚪ NEUTRAL'}
              </p>
            </div>
          </div>
        )}

        {/* Signal Panel */}
        {intel && (
          <Panel title="Signal Analysis" subtitle="Stablecoin flow interpretation">
            <div className="p-3">
              <div className={`flex items-center gap-2 p-3 rounded border ${signalBg}`}>
                {intel.signal === 'risk-on' ? (
                  <ArrowUpRight size={16} className="text-data-bull shrink-0" />
                ) : intel.signal === 'risk-off' ? (
                  <ArrowDownRight size={16} className="text-data-bear shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="text-text-muted shrink-0" />
                )}
                <div>
                  <p className={`text-sm font-mono font-bold ${signalColor}`}>
                    {intel.signal === 'risk-on' ? 'Risk-On Environment' : intel.signal === 'risk-off' ? 'Risk-Off Environment' : 'Neutral'}
                  </p>
                  <p className="text-[11px] text-text-muted font-mono mt-1">{intel.signalReason}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3 text-[11px] font-mono text-text-muted">
                <div>
                  <span className="text-text-secondary">Rising dominance</span> = capital flowing into stablecoins (risk-off, potential buying power)
                </div>
                <div>
                  <span className="text-text-secondary">Falling dominance</span> = capital deploying into risk assets (risk-on, bullish momentum)
                </div>
                <div>
                  <span className="text-text-secondary">Supply increasing</span> = new money minting (bullish — fresh liquidity entering)
                </div>
                <div>
                  <span className="text-text-secondary">Supply decreasing</span> = redemptions (bearish — capital leaving crypto)
                </div>
              </div>
            </div>
          </Panel>
        )}

        {/* Supply Chart */}
        {chartData.length > 0 && (
          <Panel title="Stablecoin Supply Over Time" subtitle={`${chartData.length} data points`}>
            <div className="p-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="supplyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} tickFormatter={(v: number) => `$${v.toFixed(0)}B`} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d24', border: '1px solid #2a2d34', borderRadius: 8, fontSize: 11 }}
                    formatter={((value: number) => [`$${value.toFixed(2)}B`, 'Supply']) as never}
                  />
                  <Area type="monotone" dataKey="total" stroke="#14b8a6" fill="url(#supplyGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}

        {/* Dominance Chart */}
        {chartData.length > 0 && (
          <Panel title="Stablecoin Dominance" subtitle="Share of total crypto market cap">
            <div className="p-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="domGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d24', border: '1px solid #2a2d34', borderRadius: 8, fontSize: 11 }}
                    formatter={((value: number) => [`${value.toFixed(2)}%`, 'Dominance']) as never}
                  />
                  <Area type="monotone" dataKey="dominance" stroke="#a855f7" fill="url(#domGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}

        {/* Individual Stablecoin Cards */}
        {intel && intel.coins.length > 0 && (
          <Panel title="Stablecoin Breakdown" subtitle={`${intel.coins.length} tracked stablecoins`}>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {intel.coins.map((coin) => {
                const share = intel.totalSupply > 0 ? (coin.marketCap / intel.totalSupply) * 100 : 0
                return (
                  <div key={coin.symbol} className="border border-border-dim rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COIN_COLORS[coin.symbol] ?? '#6b7280' }}
                        />
                        <span className="text-sm font-mono font-bold text-text-primary">{coin.symbol}</span>
                        <span className="text-[10px] text-text-muted">{coin.name}</span>
                      </div>
                      <span className={`text-xs font-mono font-bold ${coin.change24h >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                        {coin.change24h >= 0 ? <TrendingUp size={10} className="inline mr-1" /> : <TrendingDown size={10} className="inline mr-1" />}
                        {fmtChange(coin.change24h)}
                      </span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[10px] text-text-muted font-mono">MARKET CAP</p>
                        <p className="text-lg font-mono font-bold text-teal-vivid">{fmtB(coin.marketCap)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-text-muted font-mono">SHARE</p>
                        <p className="text-lg font-mono font-bold">{share.toFixed(1)}%</p>
                      </div>
                    </div>
                    {/* Share bar */}
                    <div className="w-full h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${share}%`,
                          backgroundColor: COIN_COLORS[coin.symbol] ?? '#6b7280',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center p-8">
            <p className="text-text-muted text-sm font-mono">Loading stablecoin intelligence...</p>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
