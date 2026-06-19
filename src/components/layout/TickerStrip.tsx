"use client"

import { useState, useEffect } from "react"

interface TickerItem {
  symbol: string
  price: string
  change: string
  positive: boolean
}

// Default tickers — will be replaced with live data from module registry
const DEFAULT_TICKERS: TickerItem[] = [
  { symbol: "BTC", price: "—", change: "—", positive: true },
  { symbol: "ETH", price: "—", change: "—", positive: true },
  { symbol: "SOL", price: "—", change: "—", positive: true },
  { symbol: "GOLD", price: "—", change: "—", positive: true },
  { symbol: "DXY", price: "—", change: "—", positive: false },
  { symbol: "SPX", price: "—", change: "—", positive: true },
]

export function TickerStrip() {
  const [tickers, setTickers] = useState<TickerItem[]>(DEFAULT_TICKERS)
  const [fgValue, setFgValue] = useState<number | null>(null)

  useEffect(() => {
    // Fetch prices + sentiment in parallel
    Promise.allSettled([
      fetch('/api/v1/market/prices').then(r => r.json()),
      fetch('/api/v1/market/sentiment').then(r => r.json()),
    ]).then(([priceRes, fgRes]) => {
      if (priceRes.status === 'fulfilled' && priceRes.value?.tickers?.length) {
        setTickers(priceRes.value.tickers)
      }
      if (fgRes.status === 'fulfilled' && fgRes.value?.fearGreed != null) {
        setFgValue(fgRes.value.fearGreed)
      }
    })
  }, [])

  const fgColor = fgValue == null ? 'text-text-dim' : fgValue >= 55 ? 'text-accent-green' : fgValue >= 45 ? 'text-accent-amber' : 'text-accent-red'
  const fgLabel = fgValue == null ? '—' : fgValue >= 55 ? 'Greed' : fgValue >= 45 ? 'Neutral' : 'Fear'

  return (
    <div className="bg-bg-panel border-b border-border-dim px-4 py-1.5 flex items-center gap-4 text-xs font-mono overflow-hidden">
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="w-2 h-2 rounded-full bg-accent-green animate-live-dot" />
        <span className="text-accent-green font-semibold">LIVE</span>
      </span>

      <div className="ticker-strip flex-1">
        <div className="ticker-content">
          {[...tickers, ...tickers].map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 mr-6">
              <span className="text-text-dim">{t.symbol}</span>
              <span className="text-text-primary">{t.price}</span>
              <span className={t.positive ? 'text-accent-green' : 'text-accent-red'}>
                {t.change}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 text-text-dim">
        <span className="flex items-center gap-1">
          FEAR/GREED: <span className={fgColor}>{fgValue ?? '—'} {fgLabel}</span>
        </span>
        <span>|</span>
        <TickerClock />
      </div>
    </div>
  )
}

function TickerClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 10_000)
    return () => clearInterval(id)
  }, [])
  return <span>{time}</span>
}
