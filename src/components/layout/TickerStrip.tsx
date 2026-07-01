"use client"

import { useState, useEffect } from "react"
import { useTicker } from "@/lib/hooks/useWsStream"
import { useUserPreferences, BaseCurrency } from "@/lib/hooks/useUserPreferences"

const TICKER_CONFIG = [
  { symbol: "BTC" },
  { symbol: "ETH" },
  { symbol: "SOL" },
  { symbol: "EUR/USD" },
  { symbol: "GBP/USD" },
  { symbol: "USD/JPY" },
  { symbol: "USD/IDR" },
  { symbol: "GOLD" },
  { symbol: "IHSG" },
  { symbol: "S&P 500" },
]

function LiveTicker({ symbol }: { symbol: string }) {
  const { price, change, connected } = useTicker(symbol)
  const { format } = useUserPreferences()

  if (!connected || price === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 mr-6">
        <span className="text-text-dim">{symbol}</span>
        <span className="text-text-dim">—</span>
      </span>
    )
  }

  const positive = change >= 0
  const isAsset = !symbol.includes('/')

  return (
    <span className="inline-flex items-center gap-1.5 mr-6">
      <span className="text-text-dim">{symbol}</span>
      <span className="text-text-primary font-mono">
        {isAsset ? format(price) : price.toLocaleString(undefined, { maximumFractionDigits: price > 100 ? 0 : 4 })}
      </span>
      <span className={`font-mono ${positive ? 'text-accent-green' : 'text-accent-red'}`}>
        {positive ? '+' : ''}{change.toFixed(2)}%
      </span>
    </span>
  )
}

export function TickerStrip() {
  const [fgValue, setFgValue] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/v1/fear-greed')
      .then(r => r.json())
      .then(d => {
        const val = d.data?.composite?.score ?? d.data?.value
        if (val != null) setFgValue(val)
      })
      .catch(() => {})
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
          {TICKER_CONFIG.map(t => (
            <LiveTicker key={t.symbol} symbol={t.symbol} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 text-text-dim">
        <span className="flex items-center gap-1">
          FEAR/GREED: <span className={fgColor}>{fgValue ?? '—'} {fgLabel}</span>
        </span>
        <span>|</span>
        <CurrencySelector />
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

function CurrencySelector() {
  const { currency, setCurrency, fetchRates } = useUserPreferences()

  useEffect(() => {
    fetchRates()
  }, [fetchRates])

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-text-muted">CURR:</span>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as BaseCurrency)}
        className="bg-transparent text-text-muted hover:text-text-primary outline-none cursor-pointer border-none font-mono text-[10px] uppercase font-bold"
      >
        <option value="USD">USD</option>
        <option value="IDR">IDR</option>
        <option value="EUR">EUR</option>
        <option value="GBP">GBP</option>
        <option value="JPY">JPY</option>
        <option value="SGD">SGD</option>
      </select>
    </div>
  )
}
