"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface OrderBookLevel {
  price: number
  quantity: number
  total: number
}

interface OrderBookData {
  symbol: string
  binanceSymbol: string
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  bidDepth: number
  askDepth: number
  spread: number
  spreadBps: number
  midPrice: number
  ticker: {
    price: number
    change24h: number
    volume24h: number
    high24h: number
    low24h: number
  }
  imbalance: number
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'ARB', 'OP']

export default function OrderBookPage() {
  const [data, setData] = useState<OrderBookData | null>(null)
  const [symbol, setSymbol] = useState('BTC')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/orderbook?symbol=${symbol}`)
      const d = await res.json()
      if (d.success && d.data) {
        setData(d.data as OrderBookData)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [symbol])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 5_000) // 5s refresh for live depth
    return () => clearInterval(id)
  }, [fetchData])

  const maxTotal = data ? Math.max(
    ...data.bids.map(b => b.total),
    ...data.asks.map(a => a.total)
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
              Real-time bid/ask depth from Binance. Shows liquidity imbalance and spread.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-bg-raised p-1 rounded">
              {SYMBOLS.map(s => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={`px-3 py-1 text-[10px] font-mono rounded uppercase transition-colors ${symbol === s ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <LiveDot status={status} label />
          </div>
        </div>

        {data && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-5 gap-2">
              <KPI label="Price" value={data.ticker.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
              <KPI label="24h" value={`${data.ticker.change24h > 0 ? '+' : ''}${data.ticker.change24h.toFixed(2)}%`} />
              <KPI label="Bid Depth" value={fmtUsd(data.bidDepth)} color="text-data-bull" />
              <KPI label="Ask Depth" value={fmtUsd(data.askDepth)} color="text-data-bear" />
              <KPI
                label="Imbalance"
                value={`${(data.imbalance * 100).toFixed(2)}%`}
                color={data.imbalance > 0 ? 'text-data-bull' : data.imbalance < 0 ? 'text-data-bear' : 'text-text-muted'}
              />
            </div>

            {/* Order Book */}
            <div className="grid grid-cols-2 gap-4">
              {/* Bids (Buy Orders) */}
              <Panel title="Bids (Buy Orders)" subtitle={`${data.bids.length} levels | Depth: ${fmtUsd(data.bidDepth)}`}>
                <div className="overflow-auto scrollbar-thin max-h-[500px]">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-bg-base">
                      <tr className="text-text-muted text-[10px] font-mono uppercase">
                        <th className="px-3 py-1 text-left">Price</th>
                        <th className="px-3 py-1 text-right">Quantity</th>
                        <th className="px-3 py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bids.map((bid, i) => (
                        <tr key={i} className="relative hover:bg-bg-raised transition-colors">
                          <td
                            className="absolute inset-0 bg-data-bull/10 pointer-events-none"
                            style={{ width: `${(bid.total / maxTotal) * 100}%`, right: 0, left: 'auto' }}
                          />
                          <td className="relative text-[11px] font-mono px-3 py-0.5 text-data-bull tabular-nums">
                            {bid.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-primary tabular-nums">
                            {bid.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
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

              {/* Asks (Sell Orders) */}
              <Panel title="Asks (Sell Orders)" subtitle={`${data.asks.length} levels | Depth: ${fmtUsd(data.askDepth)}`}>
                <div className="overflow-auto scrollbar-thin max-h-[500px]">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-bg-base">
                      <tr className="text-text-muted text-[10px] font-mono uppercase">
                        <th className="px-3 py-1 text-left">Price</th>
                        <th className="px-3 py-1 text-right">Quantity</th>
                        <th className="px-3 py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.asks.map((ask, i) => (
                        <tr key={i} className="relative hover:bg-bg-raised transition-colors">
                          <td
                            className="absolute inset-0 bg-data-bear/10 pointer-events-none"
                            style={{ width: `${(ask.total / maxTotal) * 100}%`, right: 0, left: 'auto' }}
                          />
                          <td className="relative text-[11px] font-mono px-3 py-0.5 text-data-bear tabular-nums">
                            {ask.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="relative text-[11px] font-mono px-3 py-0.5 text-right text-text-primary tabular-nums">
                            {ask.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
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

            {/* Spread Info */}
            <Panel title="Market Microstructure" subtitle="Spread, depth, and liquidity analysis">
              <div className="p-4 grid grid-cols-4 gap-4">
                <MicroRow label="Mid Price" value={`$${data.midPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                <MicroRow label="Spread" value={`$${data.spread.toFixed(4)}`} />
                <MicroRow label="Spread (bps)" value={`${data.spreadBps.toFixed(2)} bps`} />
                <MicroRow label="24h Range" value={`$${data.ticker.low24h.toFixed(2)} - $${data.ticker.high24h.toFixed(2)}`} />
                <MicroRow
                  label="Bid/Ask Ratio"
                  value={`${(data.bidDepth / Math.max(1, data.askDepth)).toFixed(2)}`}
                  color={data.bidDepth > data.askDepth ? 'text-data-bull' : 'text-data-bear'}
                />
                <MicroRow
                  label="Total Liquidity"
                  value={fmtUsd(data.bidDepth + data.askDepth)}
                />
                <MicroRow label="Last Update" value={new Date(data.ticker.price).toLocaleTimeString()} />
                <MicroRow
                  label="Market Signal"
                  value={data.imbalance > 0.1 ? '🟢 Buying Pressure' : data.imbalance < -0.1 ? '🔴 Selling Pressure' : '⚪ Balanced'}
                  color={data.imbalance > 0.1 ? 'text-data-bull' : data.imbalance < -0.1 ? 'text-data-bear' : 'text-text-muted'}
                />
              </div>
            </Panel>
          </>
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

function MicroRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[14px] font-mono font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}