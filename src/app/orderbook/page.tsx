"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
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
  ticker: {
    price: number
    change24h: number
    volume24h: number
    high24h: number
    low24h: number
  }
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'ARB', 'OP']

export default function OrderBookPage() {
  const [data, setData] = useState<OrderBookData | null>(null)
  const [symbol, setSymbol] = useState('BTC')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())

  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // REST fallback for ticker data
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/orderbook?symbol=${symbol}`)
      const d = await res.json()
      if (d.data) {
        setData(d.data as OrderBookData)
        setStatus('live')
        setLastUpdate(new Date())
      }
    } catch { /* silent */ }
  }, [symbol])

  // WebSocket for realtime depth updates
  useEffect(() => {
    const binanceSymbol = symbol.toLowerCase() + 'usdt'
    let ws: WebSocket | null = null
    let reconnectTimeout: NodeJS.Timeout

    const connect = () => {
      try {
        // Connect directly to Binance depth stream (free, no key)
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceSymbol}@depth20@100ms`)
        wsRef.current = ws

        ws.onopen = () => {
          setWsConnected(true)
          setStatus('live')
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as { bids: Array<[string, string]>; asks: Array<[string, string]> }
            const bids: DepthLevel[] = (msg.bids ?? []).slice(0, 15).map(([p, q]) => {
              const price = parseFloat(p); const quantity = parseFloat(q)
              return { price, quantity, total: price * quantity }
            })
            const asks: DepthLevel[] = (msg.asks ?? []).slice(0, 15).map(([p, q]) => {
              const price = parseFloat(p); const quantity = parseFloat(q)
              return { price, quantity, total: price * quantity }
            })
            const bidDepth = bids.reduce((s, b) => s + b.total, 0)
            const askDepth = asks.reduce((s, a) => s + a.total, 0)
            const bestBid = bids[0]?.price ?? 0
            const bestAsk = asks[0]?.price ?? 0
            const midPrice = (bestBid + bestAsk) / 2
            const spread = bestAsk - bestBid
            const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0
            const imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0

            setData(prev => ({
              bids, asks, bidDepth, askDepth, spread, spreadBps, midPrice, imbalance,
              ticker: prev?.ticker ?? { price: midPrice, change24h: 0, volume24h: 0, high24h: 0, low24h: 0 },
            }))
            setLastUpdate(new Date())
          } catch { /* silent */ }
        }

        ws.onerror = () => setWsConnected(false)
        ws.onclose = () => {
          setWsConnected(false)
          reconnectTimeout = setTimeout(connect, 3000)
        }
      } catch { /* silent */ }
    }

    connect()
    // Also fetch ticker data via REST every 30s
    fetchData()
    const tickerInterval = setInterval(fetchData, 30_000)

    return () => {
      clearTimeout(reconnectTimeout)
      clearInterval(tickerInterval)
      if (ws) ws.close()
    }
  }, [symbol, fetchData])

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
              Real-time bid/ask depth from Binance • Updated {lastUpdate.toLocaleTimeString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-bg-raised p-1 rounded">
              {SYMBOLS.map(s => (
                <button
                  key={s}
                  onClick={() => { setSymbol(s); setData(null) }}
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
                      <td className="absolute inset-0 bg-data-bull/10 pointer-events-none" style={{ width: `${(bid.total / maxTotal) * 100}%`, right: 0, left: 'auto' }} />
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-data-bull tabular-nums">{bid.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-primary tabular-nums">{bid.quantity.toFixed(4)}</td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-secondary tabular-nums">{fmtUsd(bid.total)}</td>
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
                      <td className="absolute inset-0 bg-data-bear/10 pointer-events-none" style={{ width: `${(ask.total / maxTotal) * 100}%`, right: 0, left: 'auto' }} />
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-data-bear tabular-nums">{ask.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-primary tabular-nums">{ask.quantity.toFixed(4)}</td>
                      <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-secondary tabular-nums">{fmtUsd(ask.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* Market Microstructure Analysis */}
        {data && (
          <Panel title="Market Microstructure Analysis" subtitle="Order book signal interpretation">
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-bg-raised p-3 rounded border border-bg-border">
                  <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Bid/Ask Ratio</div>
                  <div className={`text-[18px] font-head font-bold tabular-nums ${data.bidDepth > data.askDepth ? 'text-data-bull' : 'text-data-bear'}`}>
                    {(data.bidDepth / Math.max(1, data.askDepth)).toFixed(2)}
                  </div>
                  <div className="text-[10px] font-mono text-text-muted mt-1">
                    {data.bidDepth > data.askDepth * 1.2 ? '🟢 More buyers than sellers' :
                     data.askDepth > data.bidDepth * 1.2 ? '🔴 More sellers than buyers' :
                     '⚪ Balanced market'}
                  </div>
                </div>

                <div className="bg-bg-raised p-3 rounded border border-bg-border">
                  <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Spread Quality</div>
                  <div className={`text-[18px] font-head font-bold tabular-nums ${data.spreadBps < 1 ? 'text-data-bull' : data.spreadBps < 5 ? 'text-accent-amber' : 'text-data-bear'}`}>
                    {data.spreadBps.toFixed(2)} bps
                  </div>
                  <div className="text-[10px] font-mono text-text-muted mt-1">
                    {data.spreadBps < 1 ? '🟢 Ultra-tight (high liquidity)' :
                     data.spreadBps < 5 ? '🟡 Normal spread' :
                     '🔴 Wide spread (low liquidity)'}
                  </div>
                </div>

                <div className="bg-bg-raised p-3 rounded border border-bg-border">
                  <div className="text-[10px] text-text-muted font-mono uppercase mb-1">Total Liquidity</div>
                  <div className="text-[18px] font-head font-bold tabular-nums text-text-primary">
                    {fmtUsd(data.bidDepth + data.askDepth)}
                  </div>
                  <div className="text-[10px] font-mono text-text-muted mt-1">
                    {data.bidDepth + data.askDepth > 1e6 ? '🟢 Deep liquidity' :
                     data.bidDepth + data.askDepth > 1e5 ? '🟡 Moderate liquidity' :
                     '🔴 Thin liquidity'}
                  </div>
                </div>
              </div>

              {/* AI Verdict */}
              <div className="bg-bg-raised p-4 rounded border border-bg-border">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-mono font-bold text-teal-vivid">🧠 AI VERDICT</span>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                    data.imbalance > 0.15 ? 'bg-data-bull/20 text-data-bull' :
                    data.imbalance < -0.15 ? 'bg-data-bear/20 text-data-bear' :
                    'bg-bg-raised text-text-muted'
                  }`}>
                    {data.imbalance > 0.15 ? 'BULLISH' : data.imbalance < -0.15 ? 'BEARISH' : 'NEUTRAL'}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-text-secondary leading-relaxed space-y-1">
                  <p>
                    {symbol} order book shows {data.bidDepth > data.askDepth * 1.2 ? 'strong buying pressure' :
                    data.askDepth > data.bidDepth * 1.2 ? 'strong selling pressure' :
                    'balanced bid/ask depth'} with a {data.spreadBps < 1 ? 'very tight' : data.spreadBps < 5 ? 'normal' : 'wide'} spread of {data.spreadBps.toFixed(2)} bps.
                  </p>
                  <p>
                    {data.imbalance > 0.15
                      ? `Buyers dominate with ${(data.imbalance * 100).toFixed(1)}% more bid depth. This suggests accumulation — price may push higher if buying pressure sustains.`
                      : data.imbalance < -0.15
                      ? `Sellers dominate with ${(Math.abs(data.imbalance) * 100).toFixed(1)}% more ask depth. This suggests distribution — price may face resistance at current levels.`
                      : 'Market is balanced between buyers and sellers. No strong directional bias detected.'}
                  </p>
                  <p>
                    {data.bids.length > 0 && data.bids[0].total > data.askDepth * 0.1
                      ? `Strong bid wall at $${data.bids[0].price.toLocaleString()} (${fmtUsd(data.bids[0].total)}) may act as support.`
                      : 'No significant bid walls detected near current price.'}
                    {' '}
                    {data.asks.length > 0 && data.asks[0].total > data.bidDepth * 0.1
                      ? `Strong ask wall at $${data.asks[0].price.toLocaleString()} (${fmtUsd(data.asks[0].total)}) may act as resistance.`
                      : 'No significant ask walls detected near current price.'}
                  </p>
                </div>
              </div>

              {/* Depth Visualization */}
              <div className="bg-bg-raised p-3 rounded border border-bg-border">
                <div className="text-[10px] font-mono text-text-muted uppercase mb-2">Depth Visualization</div>
                <div className="space-y-0.5">
                  {data.asks.slice(0, 7).reverse().map((ask, i) => (
                    <div key={`ask-${i}`} className="flex items-center gap-1">
                      <span className="text-[9px] font-mono text-text-muted w-20 text-right tabular-nums">${ask.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <div className="flex-1 h-2 relative">
                        <div className="absolute right-0 top-0 h-full bg-data-bear/40 rounded-sm" style={{ width: `${(ask.total / (data.bidDepth + data.askDepth)) * 200}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-data-bear w-16 text-right tabular-nums">{fmtUsd(ask.total)}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1 py-0.5">
                    <span className="text-[9px] font-mono text-teal-vivid w-20 text-right font-bold tabular-nums">${data.midPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <div className="flex-1 h-px bg-teal-vivid" />
                    <span className="text-[9px] font-mono text-teal-vivid w-16 text-right">MID</span>
                  </div>
                  {data.bids.slice(0, 7).map((bid, i) => (
                    <div key={`bid-${i}`} className="flex items-center gap-1">
                      <span className="text-[9px] font-mono text-text-muted w-20 text-right tabular-nums">${bid.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <div className="flex-1 h-2 relative">
                        <div className="absolute left-0 top-0 h-full bg-data-bull/40 rounded-sm" style={{ width: `${(bid.total / (data.bidDepth + data.askDepth)) * 200}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-data-bull w-16 text-right tabular-nums">{fmtUsd(bid.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        )}
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