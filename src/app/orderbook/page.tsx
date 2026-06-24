"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface DepthLevel {
  price: number
  quantity: number
  total: number
}

interface OrderBookData {
  bids: DepthLevel[]
  asks: DepthLevel[]
  bidDepth: number
  askDepth: number
  spread: number
  spreadBps: number
  midPrice: number
  imbalance: number
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'ARB', 'OP']

export default function OrderBookPage() {
  const [data, setData] = useState<OrderBookData | null>(null)
  const [symbol, setSymbol] = useState('BTC')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const tickerRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch ticker data via REST (price, 24h stats)
  const fetchTicker = useCallback(async (sym: string) => {
    try {
      const res = await fetch(`/api/v1/orderbook?symbol=${sym}`)
      const d = await res.json()
      if (d.data) {
        const ob = d.data as OrderBookData
        setData(prev => prev ? { ...prev, ...ob } : ob)
      }
    } catch { /* silent */ }
  }, [])

  // WebSocket connection for realtime depth
  useEffect(() => {
    const wsUrl = `wss://${window.location.hostname}:4401/socket.io/?EIO=4&transport=websocket`
    
    // Use Socket.IO protocol for WS server
    const connectWs = () => {
      try {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          setStatus('live')
          // Subscribe to orderbook room
          ws.send(`42/orderbook,["subscribe","${symbol}usdt"]`)
        }

        ws.onmessage = (event) => {
          try {
            const raw = event.data as string
            // Socket.IO wraps messages: 42/namespace,[event,data]
            if (raw.startsWith('42/orderbook,')) {
              const payload = JSON.parse(raw.slice(14))
              if (payload[0] === 'depth') {
                const depthData = payload[1]
                const bids: DepthLevel[] = (depthData.bids as Array<[string, string]>)
                  .slice(0, 15)
                  .map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q), total: parseFloat(p) * parseFloat(q) }))
                const asks: DepthLevel[] = (depthData.asks as Array<[string, string]>)
                  .slice(0, 15)
                  .map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q), total: parseFloat(p) * parseFloat(q) }))

                bids.sort((a, b) => b.price - a.price)
                asks.sort((a, b) => a.price - b.price)

                const bidDepth = bids.reduce((s, b) => s + b.total, 0)
                const askDepth = asks.reduce((s, a) => s + a.total, 0)
                const bestBid = bids[0]?.price ?? 0
                const bestAsk = asks[0]?.price ?? 0
                const midPrice = (bestBid + bestAsk) / 2
                const spread = bestAsk - bestBid
                const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0
                const imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0

                setData((_) => ({
                  bids,
                  asks,
                  bidDepth,
                  askDepth,
                  spread,
                  spreadBps,
                  midPrice,
                  imbalance,
                }))
              }
            }
          } catch { /* silent parse errors */ }
        }

        ws.onerror = () => setStatus('error')
        ws.onclose = () => {
          setConnected(false)
          setStatus('stale')
          // Reconnect after 3s
          setTimeout(connectWs, 3000)
        }
      } catch {
        setStatus('error')
      }
    }

    connectWs()

    // Also fetch ticker via REST every 10s
    fetchTicker(symbol)
    tickerRef.current = setInterval(() => fetchTicker(symbol), 10_000)

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (tickerRef.current) {
        clearInterval(tickerRef.current)
      }
    }
  }, [symbol, fetchTicker])

  // Switch symbol
  const switchSymbol = (sym: string) => {
    if (wsRef.current && connected) {
      // Unsubscribe old, subscribe new
      wsRef.current.send(`42/orderbook,["unsubscribe","${symbol}usdt"]`)
      wsRef.current.send(`42/orderbook,["subscribe","${sym}usdt"]`)
    }
    setSymbol(sym)
    setData(null)
  }

  const maxTotal = data ? Math.max(
    ...data.bids.map(b => b.total),
    ...data.asks.map(a => a.total),
    1
  ) : 1

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">📊</span> Order Book Depth
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              {connected ? '🟢 WebSocket connected — sub-second updates' : '🔴 Connecting...'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-bg-raised p-1 rounded">
              {SYMBOLS.map(s => (
                <button
                  key={s}
                  onClick={() => switchSymbol(s)}
                  className={`px-3 py-1 text-[10px] font-mono rounded uppercase transition-colors ${symbol === s ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <LiveDot status={status} label />
          </div>
        </div>

        {/* KPI Strip */}
        {data && (
          <div className="grid grid-cols-5 gap-2">
            <KPI label="Price" value={`$${data.midPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            <KPI label="Spread" value={`${data.spreadBps.toFixed(2)} bps`} />
            <KPI label="Bid Depth" value={fmtUsd(data.bidDepth)} color="text-data-bull" />
            <KPI label="Ask Depth" value={fmtUsd(data.askDepth)} color="text-data-bear" />
            <KPI
              label="Imbalance"
              value={`${(data.imbalance * 100).toFixed(1)}%`}
              color={data.imbalance > 0.1 ? 'text-data-bull' : data.imbalance < -0.1 ? 'text-data-bear' : 'text-text-muted'}
            />
          </div>
        )}

        {/* Order Book */}
        <div className="grid grid-cols-2 gap-4">
          {/* Bids */}
          <Panel title="Bids (Buy)" subtitle={`${data?.bids.length ?? 0} levels`}>
            <div className="overflow-auto scrollbar-thin max-h-[500px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-bg-base">
                  <tr className="text-text-muted">
                    <th className="text-[10px] font-mono px-3 py-1 text-left">Price</th>
                    <th className="text-[10px] font-mono px-3 py-1 text-right">Qty</th>
                    <th className="text-[10px] font-mono px-3 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.bids ?? []).map((bid, i) => (
                    <tr key={i} className="relative hover:bg-bg-raised transition-colors">
                      <td
                        className="absolute inset-0 bg-data-bull/10 pointer-events-none"
                        style={{ width: `${(bid.total / maxTotal) * 100}%`, right: 0, left: 'auto' }}
                      />
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-data-bull tabular-nums">
                        {bid.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-primary tabular-nums">
                        {bid.quantity.toFixed(4)}
                      </td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-secondary tabular-nums">
                        {fmtUsd(bid.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Asks */}
          <Panel title="Asks (Sell)" subtitle={`${data?.asks.length ?? 0} levels`}>
            <div className="overflow-auto scrollbar-thin max-h-[500px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-bg-base">
                  <tr className="text-text-muted">
                    <th className="text-[10px] font-mono px-3 py-1 text-left">Price</th>
                    <th className="text-[10px] font-mono px-3 py-1 text-right">Qty</th>
                    <th className="text-[10px] font-mono px-3 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.asks ?? []).map((ask, i) => (
                    <tr key={i} className="relative hover:bg-bg-raised transition-colors">
                      <td
                        className="absolute inset-0 bg-data-bear/10 pointer-events-none"
                        style={{ width: `${(ask.total / maxTotal) * 100}%`, right: 0, left: 'auto' }}
                      />
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-data-bear tabular-nums">
                        {ask.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-primary tabular-nums">
                        {ask.quantity.toFixed(4)}
                      </td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-secondary tabular-nums">
                        {fmtUsd(ask.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
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

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}