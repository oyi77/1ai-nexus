"use client"

import { useEffect, useRef } from 'react'

interface TradingViewChartProps {
  symbol?: string
  interval?: string
  theme?: 'dark' | 'light'
  height?: number
  studies?: string[]
}

/**
 * TradingView Advanced Chart Widget
 * Free, no API key, professional-grade charting
 * Includes: 100+ indicators, drawing tools, multi-timeframe, real-time
 */
export function TradingViewChart({
  symbol = 'BINANCE:BTCUSDT',
  interval = '60',
  theme = 'dark',
  height = 500,
  studies = [],
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Clear previous chart
    el.innerHTML = ''

    const widgetContainer = document.createElement('div')
    widgetContainer.className = 'tradingview-widget-container'
    widgetContainer.style.height = `${height}px`
    widgetContainer.style.width = '100%'

    const widgetDiv = document.createElement('div')
    widgetDiv.className = 'tradingview-widget-container__widget'
    widgetDiv.style.height = 'calc(100% - 32px)'
    widgetDiv.style.width = '100%'
    widgetContainer.appendChild(widgetDiv)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: symbol,
      interval: interval,
      timezone: 'Etc/UTC',
      theme: theme,
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      hide_volume: false,
      studies: studies,
      save_image: false,
      backgroundColor: 'rgba(10, 10, 10, 1)',
      gridColor: 'rgba(26, 26, 26, 1)',
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      details: true,
      hotlist: true,
      show_popup_button: true,
    })

    widgetContainer.appendChild(script)
    el.appendChild(widgetContainer)

    return () => {
      if (el) {
        el.innerHTML = ''
      }
    }
  }, [symbol, interval, theme, height, studies])

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}