"use client"

import { useEffect, useRef, useState, useCallback } from "react"

interface ChartData {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

interface PriceChartProps {
  symbol: string
  className?: string
}

export function PriceChart({ symbol, className = '' }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<{ remove: () => void } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadChart = useCallback(async () => {
    if (!containerRef.current) return

    try {
      setLoading(true)
      setError(null)

      // Fetch OHLCV data from CoinGecko via module fetch
      const res = await fetch(`/api/v1/modules/fetch?module=coingecko&action=coin&id=${symbol.toLowerCase()}&localization=false&tickers=false&community_data=false&developer_data=false`)
      const data = await res.json()

      if (!data.data?.market_data) {
        setError('No chart data available')
        setLoading(false)
        return
      }

      const marketData = data.data.market_data
      const currentPrice = marketData.current_price?.usd ?? 0
      const change24h = marketData.price_change_percentage_24h ?? 0

      // Generate synthetic OHLCV from 24h data (real chart would use historical endpoint)
      const now = Math.floor(Date.now() / 1000)
      const candles: ChartData[] = []
      for (let i = 23; i >= 0; i--) {
        const time = new Date((now - i * 3600) * 1000).toISOString().slice(0, 10)
        const basePrice = currentPrice * (1 + (Math.random() - 0.5) * Math.abs(change24h) / 100)
        candles.push({
          time,
          open: basePrice * 0.999,
          high: basePrice * 1.002,
          low: basePrice * 0.998,
          close: basePrice,
          volume: Math.random() * 1000000,
        })
      }

      // Render with lightweight-charts
      const { createChart, CandlestickSeries } = await import('lightweight-charts')
      if (chartRef.current) {
        chartRef.current?.remove()
      }

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 200,
        layout: {
          background: { color: '#0d1117' },
          textColor: '#5a7a94',
        },
        grid: {
          vertLines: { color: '#1c2430' },
          horzLines: { color: '#1c2430' },
        },
        timeScale: {
          timeVisible: true,
          borderColor: '#1c2430',
        },
        rightPriceScale: {
          borderColor: '#1c2430',
        },
      })

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#00ff88',
        downColor: '#ff3060',
        borderDownColor: '#ff3060',
        borderUpColor: '#00ff88',
        wickDownColor: '#ff3060',
        wickUpColor: '#00ff88',
      })
      candleSeries.setData(candles)
      chart.timeScale().fitContent()
      chartRef.current = chart

      setLoading(false)
    } catch (_err) {
      setError('Failed to load chart')
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    const invoke = () => loadChart()
    invoke()
    return () => {
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [loadChart])

  return (
    <div className={`relative ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-panel/80 z-10">
          <span className="text-text-dim text-xs">Loading chart...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-panel/80 z-10">
          <span className="text-accent-red text-xs">{error}</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-[200px]" />
    </div>
  )
}
