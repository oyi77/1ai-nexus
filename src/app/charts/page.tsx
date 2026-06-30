"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
} from 'lightweight-charts'

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Drawing tool types
type DrawingTool = 'crosshair' | 'trendline' | 'horizontal' | 'fibonacci' | 'rectangle' | 'text'

interface Drawing {
  id: string
  tool: DrawingTool
  points: { time: number; price: number }[]
  color: string
  label?: string
}

const TOOL_COLORS: Record<DrawingTool, string> = {
  crosshair: '#ffffff',
  trendline: '#3b82f6',
  horizontal: '#f59e0b',
  fibonacci: '#10b981',
  rectangle: '#8b5cf6',
  text: '#ef4444',
}

const CHART_SYMBOLS = [
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'BBCA.JK', name: 'BCA' },
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'GLD', name: 'Gold' },
]

export default function ChartsPage() {
  const [selected, setSelected] = useState('BTC-USD')
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTool, setActiveTool] = useState<DrawingTool>('crosshair')
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [timeframe, setTimeframe] = useState('1d')
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  // Fetch OHLCV data
  useEffect(() => {
    setLoading(true)
    const fetchCandles = async () => {
      try {
        const range = timeframe === '1d' ? '3mo' : timeframe === '1h' ? '5d' : '1mo'
        const interval = timeframe === '1d' ? '1d' : timeframe === '1h' ? '1h' : '1wk'
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(selected)}?interval=${interval}&range=${range}`
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        const data = await res.json()
        const result = data.chart?.result?.[0]
        if (!result?.timestamp) { setLoading(false); return }

        const timestamps = result.timestamp
        const quotes = result.indicators.quote[0]
        const candleData: Candle[] = []

        for (let i = 0; i < timestamps.length; i++) {
          if (quotes.open[i] && quotes.high[i] && quotes.low[i] && quotes.close[i]) {
            candleData.push({
              time: timestamps[i],
              open: quotes.open[i],
              high: quotes.high[i],
              low: quotes.low[i],
              close: quotes.close[i],
              volume: quotes.volume[i] ?? 0,
            })
          }
        }

        setCandles(candleData)
        setLoading(false)
      } catch {
        setLoading(false)
      }
    }

    fetchCandles()
  }, [selected, timeframe])

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#080b0f' },
        textColor: '#9ca3af',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: {
        mode: activeTool === 'crosshair' ? 0 : 1,
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
    })

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    candleSeries.setData(candles.map(c => ({
      time: c.time as unknown as import('lightweight-charts').Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })))

    // Volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volumeSeries.setData(candles.map(c => ({
      time: c.time as unknown as import('lightweight-charts').Time,
      value: c.volume,
      color: c.close >= c.open ? '#22c55e44' : '#ef444444',
    })))

    // SMA 20
    const sma20Data = computeSMA(candles, 20)
    if (sma20Data.length > 0) {
      const sma20Series = chart.addSeries(LineSeries, {
        color: '#ff9800',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      sma20Series.setData(sma20Data)
    }

    // SMA 50
    const sma50Data = computeSMA(candles, 50)
    if (sma50Data.length > 0) {
      const sma50Series = chart.addSeries(LineSeries, {
        color: '#2196f3',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      sma50Series.setData(sma50Data)
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    return () => { chart.remove() }
  }, [candles, activeTool])

  // Handle drawing on chart click
  const handleChartClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'crosshair' || !chartRef.current) return

    const chart = chartRef.current
    const rect = chartContainerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const time = chart.timeScale().coordinateToTime(x)
    if (time == null) return

    // Approximate price from y coordinate
    const priceScale = chart.priceScale('right')
    const price = (priceScale as unknown as { coordinateToPrice: (y: number) => number }).coordinateToPrice(y)

    const newDrawing: Drawing = {
      id: Date.now().toString(),
      tool: activeTool,
      points: [{ time: time as unknown as number, price }],
      color: TOOL_COLORS[activeTool],
    }

    setDrawings(prev => [...prev, newDrawing])
  }, [activeTool])

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">PROFESSIONAL CHARTS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {CHART_SYMBOLS.length} symbols · Drawing tools · Technical indicators
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Symbol Selector */}
        <div className="flex flex-wrap gap-2">
          {CHART_SYMBOLS.map(s => (
            <button key={s.symbol} onClick={() => setSelected(s.symbol)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected === s.symbol
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {s.symbol}
            </button>
          ))}
        </div>

        {/* Timeframe + Drawing Tools */}
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            {['1h', '1d', '1wk'].map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                  timeframe === tf
                    ? 'bg-border-active border-border-active text-text-primary'
                    : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
                }`}>
                {tf}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-border-dim" />

          <div className="flex gap-1">
            {(['crosshair', 'trendline', 'horizontal', 'fibonacci', 'rectangle', 'text'] as DrawingTool[]).map(tool => (
              <button key={tool} onClick={() => setActiveTool(tool)}
                className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                  activeTool === tool
                    ? 'text-bg-base font-bold'
                    : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
                }`}
                style={activeTool === tool ? { backgroundColor: TOOL_COLORS[tool], borderColor: TOOL_COLORS[tool] } : {}}>
                {tool.charAt(0).toUpperCase() + tool.slice(1)}
              </button>
            ))}
          </div>

          {drawings.length > 0 && (
            <button onClick={() => setDrawings([])}
              className="px-2 py-1 text-[10px] font-mono rounded border border-data-bear text-data-bear hover:bg-data-bear/10">
              Clear All
            </button>
          )}
        </div>

        {/* Chart */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading chart data...</div>
        ) : (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-mono font-bold text-text-primary">{selected}</span>
                {candles.length > 0 && (
                  <span className="ml-2 text-xs font-mono text-text-muted">
                    O: {candles[candles.length - 1].open.toFixed(2)} |
                    H: {candles[candles.length - 1].high.toFixed(2)} |
                    L: {candles[candles.length - 1].low.toFixed(2)} |
                    C: {candles[candles.length - 1].close.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-text-muted">
                <span className="w-3 h-0.5 bg-[#ff9800] inline-block" /> SMA 20
                <span className="w-3 h-0.5 bg-[#2196f3] inline-block" /> SMA 50
              </div>
            </div>
            <div ref={chartContainerRef} onClick={handleChartClick} className="cursor-crosshair" />
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">DRAWING TOOLS</h2>
          <p className="text-xs text-text-dim">
            Select a tool above, then click on the chart to place it.
            Trendline: click start point, then click end point.
            Horizontal: click to place a horizontal line at that price level.
            Fibonacci: click to place retracement levels.
            Rectangle: click to place a price range box.
            Text: click to add a text annotation.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}

function computeSMA(data: Candle[], period: number): { time: import('lightweight-charts').Time; value: number }[] {
  if (data.length < period) return []

  const result: { time: import('lightweight-charts').Time; value: number }[] = []
  let sum = 0

  for (let i = 0; i < data.length; i++) {
    sum += data[i].close
    if (i >= period) sum -= data[i - period].close
    if (i >= period - 1) {
      result.push({ time: data[i].time as unknown as import('lightweight-charts').Time, value: sum / period })
    }
  }

  return result
}
