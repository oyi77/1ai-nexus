"use client"

import { useState, useEffect, useRef } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Trade {
  exchange: string
  pair: string
  price: number
  size: number
  side: 'buy' | 'sell'
  timestamp: number
  usdValue: number
}

interface PriceTick {
  symbol: string
  price: number
  change24h: number
  volume24h: number
  high24h: number
  low24h: number
  trades24h: number
}

const SYMBOLS = ['btc', 'eth', 'sol', 'xrp', 'doge', 'avax', 'link', 'arb', 'op']

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

export default function TradesPage() {
  const [prices, setPrices] = useState<Map<string, PriceTick>>(new Map())
  const [trades, setTrades] = useState<Trade[]>([])
  const [totalBuy, setTotalBuy] = useState(0)
  const [totalSell, setTotalSell] = useState(0)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)


  // Connect to WS server /trade-stream for real-time trades
  useEffect(() => {
    let buyVol = 0
    let sellVol = 0
    let reconnectTimeout: ReturnType<typeof setTimeout>

    const connect = () => {
      const ws = new WebSocket('wss://tracker-ws.aitradepulse.com/trade-stream')
      wsRef.current = ws

      ws.onopen = () => setConnected(true)

      ws.onmessage = (event) => {
        try {
          const raw = event.data as string
          // Socket.IO format: 42[event, payload]
          if (!raw.startsWith('42')) return
          const parsed = JSON.parse(raw.slice(2)) as [string, Trade]
          if (parsed[0] !== 'trade') return
          const t = parsed[1]

          if (t.side === 'buy') buyVol += t.usdValue
          else sellVol += t.usdValue
          setTotalBuy(buyVol)
          setTotalSell(sellVol)

          setTrades(prev => [t, ...prev].slice(0, 200))

          setPrices(prev => {
            const next = new Map(prev)
            const existing = next.get(t.pair)
            next.set(t.pair, {
              symbol: t.pair,
              price: t.price,
              change24h: existing?.change24h ?? 0,
              volume24h: existing?.volume24h ?? 0,
              high24h: Math.max(existing?.high24h ?? t.price, t.price),
              low24h: Math.min(existing?.low24h ?? t.price, t.price),
              trades24h: (existing?.trades24h ?? 0) + 1,
            })
            return next
          })
        } catch {}
      }

      ws.onerror = () => setConnected(false)
      ws.onclose = () => {
        setConnected(false)
        reconnectTimeout = setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimeout)
      wsRef.current?.close()
    }
  }, [])



  const totalVol = totalBuy + totalSell
  const buyPct = totalVol > 0 ? (totalBuy / totalVol) * 100 : 50

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-data-bull">📊</span> Live Trade Flow
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              {connected ? '🟢 WebSocket connected — realtime Binance trades' : '🔴 Connecting...'}
            </p>
          </div>
          <LiveDot status={connected ? 'live' : 'error'} label />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-5 gap-2">
          <KPI label="Total Volume" value={fmtUsd(totalVol)} />
          <KPI label="Buy Volume" value={fmtUsd(totalBuy)} color="text-data-bull" />
          <KPI label="Sell Volume" value={fmtUsd(totalSell)} color="text-data-bear" />
          <KPI label="Net Flow" value={fmtUsd(totalBuy - totalSell)} color={totalBuy >= totalSell ? 'text-data-bull' : 'text-data-bear'} />
          <KPI label="Trades" value={trades.length.toLocaleString()} />
        </div>

        {/* Buy/Sell Bar */}
        <div className="bg-bg-panel border border-bg-border rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono text-data-bull font-bold">{buyPct.toFixed(1)}% BUY</span>
            <span className="text-[11px] font-mono text-text-muted">Volume Ratio</span>
            <span className="text-[11px] font-mono text-data-bear font-bold">{(100 - buyPct).toFixed(1)}% SELL</span>
          </div>
          <div className="h-3 bg-bg-raised rounded-full overflow-hidden flex">
            <div className="h-full bg-data-bull transition-all duration-500" style={{ width: `${buyPct}%` }} />
            <div className="h-full bg-data-bear transition-all duration-500" style={{ width: `${100 - buyPct}%` }} />
          </div>
        </div>

        {/* Price Tickers */}
        <div className="grid grid-cols-9 gap-1">
          {SYMBOLS.map(s => {
            const p = prices.get(s.toUpperCase())
            return (
              <div key={s} className="bg-bg-panel border border-bg-border p-2 rounded text-center">
                <div className="text-[10px] font-mono text-text-muted uppercase">{s}</div>
                <div className="text-[13px] font-mono font-bold text-text-primary tabular-nums">
                  {p ? `$${p.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                </div>
              </div>
            )
          })}
        </div>

        {/* Recent Trades */}
        <Panel title="Recent Trades" subtitle="Live from Binance WebSocket — sub-second updates" liveStatus={connected ? 'live' : 'stale'}>
          <div className="space-y-0 max-h-[500px] overflow-y-auto scrollbar-thin">
            {trades.slice(0, 50).map((t, i) => (
              <div key={`${t.timestamp}-${i}`} className="flex items-center gap-3 px-3 py-1 border-b border-bg-border/30 hover:bg-bg-raised transition-colors">
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  t.side === 'buy' ? 'bg-data-bull/20 text-data-bull' : 'bg-data-bear/20 text-data-bear'
                }`}>
                  {t.side.toUpperCase()}
                </span>
                <span className="text-[11px] font-mono font-bold text-teal-vivid w-12">{t.pair}</span>
                <span className="text-[11px] font-mono text-text-primary tabular-nums flex-1">
                  ${t.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] font-mono text-text-secondary tabular-nums w-16 text-right">
                  {t.size.toFixed(4)}
                </span>
                <span className="text-[11px] font-mono font-bold text-text-primary tabular-nums w-20 text-right">
                  {fmtUsd(t.usdValue)}
                </span>
                <span className="text-[9px] font-mono text-text-muted w-16 text-right">
                  {new Date(t.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {trades.length === 0 && (
              <div className="p-8 text-center text-text-muted text-[12px] font-mono">
                Connecting to Binance WebSocket...
              </div>
            )}
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}
