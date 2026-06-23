"use client"

import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
} from 'lightweight-charts'

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface IndicatorData {
  [key: string]: Array<{ time: number; value: number }> | undefined
}

interface CandlestickChartProps {
  candles: Candle[]
  indicators?: IndicatorData
  height?: number
}

const INDICATOR_COLORS: Record<string, string> = {
  SMA20: '#ff9800',
  SMA50: '#2196f3',
  SMA200: '#9c27b0',
  EMA20: '#ff9800',
  EMA50: '#2196f3',
  BB_upper: '#26a69a',
  BB_middle: '#888',
  BB_lower: '#ef5350',
}

export function CandlestickChart({ candles, indicators, height = 400 }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor: '#888',
        fontFamily: 'monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#00b8d9', width: 1, style: 3 },
        horzLine: { color: '#00b8d9', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#333',
        scaleMargins: { top: 0.1, bottom: 0.3 },
      },
      timeScale: {
        borderColor: '#333',
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderVisible: false,
    })

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    chartRef.current = chart
    seriesRef.current = series
    volRef.current = volSeries

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [height])

  // Update candlestick data
  useEffect(() => {
    if (!seriesRef.current || !volRef.current || candles.length === 0) return

    const candleData: CandlestickData[] = candles.map(c => ({
      time: c.time as never,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const volData: HistogramData[] = candles.map(c => ({
      time: c.time as never,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
    }))

    seriesRef.current.setData(candleData)
    volRef.current.setData(volData)
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  // Update indicator overlays
  useEffect(() => {
    if (!chartRef.current || !indicators) return

    // Clear existing indicator series
    for (const [_key, series] of indicatorSeriesRef.current) {
      try { chartRef.current.removeSeries(series) } catch { /* already removed */ }
    }
    indicatorSeriesRef.current.clear()

    // Add new indicator series
    for (const [key, data] of Object.entries(indicators)) {
      if (!data || !Array.isArray(data) || data.length === 0) continue

      const color = INDICATOR_COLORS[key] ?? '#ff9800'
      const series = chartRef.current.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })

      const lineData: LineData[] = data
        .filter((d) => d && typeof d === 'object' && 'time' in d && 'value' in d)
        .map((d) => ({
          time: (d as { time: number; value: number }).time as never,
          value: (d as { time: number; value: number }).value,
        }))

      series.setData(lineData)
      indicatorSeriesRef.current.set(key, series)
    }
  }, [indicators])

  return <div ref={containerRef} className="w-full" style={{ height }} />
}