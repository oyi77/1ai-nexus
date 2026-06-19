"use client"

import { useRef, useEffect, useCallback, useState } from "react"

interface OhlcvCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

interface CanvasChartProps {
  data: OhlcvCandle[]
  width?: number
  height?: number
  showVolume?: boolean
  showBollinger?: boolean
  bollingerPeriod?: number
  bollingerStd?: number
  className?: string
}

const COLORS = {
  bg: '#07070c',
  grid: 'rgba(255,255,255,0.03)',
  gridLabel: 'rgba(255,255,255,0.25)',
  up: '#00ff88',
  down: '#ff3060',
  volume: 'rgba(255,255,255,0.08)',
  crosshair: 'rgba(255,255,255,0.12)',
  bbFill: 'rgba(155,109,255,0.03)',
  bbUpper: 'rgba(155,109,255,0.35)',
  bbLower: 'rgba(155,109,255,0.35)',
  bbMiddle: 'rgba(155,109,255,0.5)',
  text: 'rgba(255,255,255,0.25)',
}

const PAD = { t: 10, r: 60, b: 22, l: 5 }

export function CanvasChart({
  data,
  width = 800,
  height = 300,
  showVolume = true,
  showBollinger = true,
  bollingerPeriod = 20,
  bollingerStd = 2,
  className = '',
}: CanvasChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; candle?: OhlcvCandle } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const cw = rect.width
    const ch = rect.height
    const plotW = cw - PAD.l - PAD.r
    const plotH = ch - PAD.t - PAD.b

    // Auto-resize: 5px per candle minimum
    const count = Math.min(data.length, Math.floor(plotW / 5))
    const visible = data.slice(-count)
    const barW = plotW / count

    // Price range with 6% padding
    const prices = visible.flatMap(c => [c.high, c.low])
    let lo = Math.min(...prices)
    let hi = Math.max(...prices)
    const pPad = (hi - lo) * 0.06
    lo -= pPad
    hi += pPad

    const toX = (i: number) => PAD.l + i * barW + barW / 2
    const toY = (p: number) => PAD.t + plotH * (1 - (p - lo) / (hi - lo))

    // Layer 1: Background
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, cw, ch)

    // Layer 2: Grid lines + price labels
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 0.5
    const gridCount = 5
    for (let i = 0; i <= gridCount; i++) {
      const y = PAD.t + (plotH * i) / gridCount
      ctx.beginPath()
      ctx.moveTo(PAD.l, y)
      ctx.lineTo(cw - PAD.r, y)
      ctx.stroke()

      // Price label
      const price = hi - ((hi - lo) * i) / gridCount
      ctx.fillStyle = COLORS.gridLabel
      ctx.font = '9px JetBrains Mono, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(price.toFixed(price >= 1000 ? 0 : 2), cw - PAD.r + 4, y + 3)
    }

    // Layer 3: Volume bars (max 12% chart height)
    if (showVolume) {
      const maxVol = Math.max(...visible.map(c => c.volume ?? 0))
      const volH = plotH * 0.12
      for (let i = 0; i < visible.length; i++) {
        const c = visible[i]
        const v = c.volume ?? 0
        const h = maxVol > 0 ? (v / maxVol) * volH : 0
        const x = toX(i) - barW * 0.35
        ctx.fillStyle = c.close >= c.open ? 'rgba(0,255,136,0.1)' : 'rgba(255,48,96,0.1)'
        ctx.fillRect(x, PAD.t + plotH - h, barW * 0.7, h)
      }
    }

    // Layer 4: Bollinger Bands
    if (showBollinger && visible.length >= bollingerPeriod) {
      const upper: number[] = []
      const middle: number[] = []
      const lower: number[] = []

      for (let i = bollingerPeriod - 1; i < visible.length; i++) {
        const slice = visible.slice(i - bollingerPeriod + 1, i + 1)
        const mean = slice.reduce((s, c) => s + c.close, 0) / bollingerPeriod
        const variance = slice.reduce((s, c) => s + (c.close - mean) ** 2, 0) / bollingerPeriod
        const std = Math.sqrt(variance)
        middle.push(mean)
        upper.push(mean + bollingerStd * std)
        lower.push(mean - bollingerStd * std)
      }

      // Fill area between bands
      ctx.beginPath()
      for (let i = 0; i < upper.length; i++) {
        const x = toX(i + bollingerPeriod - 1)
        if (i === 0) ctx.moveTo(x, toY(upper[i]))
        else ctx.lineTo(x, toY(upper[i]))
      }
      for (let i = lower.length - 1; i >= 0; i--) {
        ctx.lineTo(toX(i + bollingerPeriod - 1), toY(lower[i]))
      }
      ctx.closePath()
      ctx.fillStyle = COLORS.bbFill
      ctx.fill()

      // Stroke lines
      const drawBBLine = (vals: number[], color: string, offset: number) => {
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        for (let i = 0; i < vals.length; i++) {
          const x = toX(i + offset)
          if (i === 0) ctx.moveTo(x, toY(vals[i]))
          else ctx.lineTo(x, toY(vals[i]))
        }
        ctx.stroke()
      }
      drawBBLine(upper, COLORS.bbUpper, bollingerPeriod - 1)
      drawBBLine(middle, COLORS.bbMiddle, bollingerPeriod - 1)
      drawBBLine(lower, COLORS.bbLower, bollingerPeriod - 1)
    }

    // Layer 5: Candles
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i]
      const x = toX(i)
      const isUp = c.close >= c.open
      const color = isUp ? COLORS.up : COLORS.down

      // Wick
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, toY(c.high))
      ctx.lineTo(x, toY(c.low))
      ctx.stroke()

      // Body
      const bodyTop = toY(Math.max(c.open, c.close))
      const bodyBot = toY(Math.min(c.open, c.close))
      const bodyH = Math.max(1, bodyBot - bodyTop)
      const bodyW = barW * 0.6

      if (isUp) {
        // Hollow for up
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.strokeRect(x - bodyW / 2, bodyTop, bodyW, bodyH)
      } else {
        // Filled for down
        ctx.fillStyle = color
        ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH)
      }
    }

    // Crosshair
    if (hover) {
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = COLORS.crosshair
      ctx.lineWidth = 0.5

      // Vertical line at nearest candle
      const candleIdx = Math.floor((hover.x - PAD.l) / barW)
      if (candleIdx >= 0 && candleIdx < visible.length) {
        const cx = toX(candleIdx)
        ctx.beginPath()
        ctx.moveTo(cx, PAD.t)
        ctx.lineTo(cx, PAD.t + plotH)
        ctx.stroke()

        // Horizontal line at mouse Y
        ctx.beginPath()
        ctx.moveTo(PAD.l, hover.y)
        ctx.lineTo(cw - PAD.r, hover.y)
        ctx.stroke()

        // Price label at mouse Y
        const hoverPrice = hi - ((hover.y - PAD.t) / plotH) * (hi - lo)
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(0,200,255,0.8)'
        ctx.font = '10px JetBrains Mono, monospace'
        ctx.textAlign = 'left'
        ctx.fillText(hoverPrice.toFixed(hoverPrice >= 1000 ? 0 : 2), cw - PAD.r + 4, hover.y + 3)
      }
      ctx.setLineDash([])
    }
  }, [data, showVolume, showBollinger, bollingerPeriod, bollingerStd, hover])

  useEffect(() => { draw() }, [draw])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const count = Math.min(data.length, Math.floor((rect.width - PAD.l - PAD.r) / 5))
    const visible = data.slice(-count)
    const barW = (rect.width - PAD.l - PAD.r) / count
    const idx = Math.floor((x - PAD.l) / barW)
    const candle = idx >= 0 && idx < visible.length ? visible[idx] : undefined
    setHover({ x, y, candle })
  }, [data])

  const handleMouseLeave = useCallback(() => setHover(null), [])

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* OHLCV tooltip */}
      {hover?.candle && (
        <div className="absolute top-1 left-2 text-[10px] font-mono pointer-events-none z-10">
          <span className="text-text-dim">O</span>
          <span className={hover.candle.close >= hover.candle.open ? 'text-accent-green' : 'text-accent-red'}>
            {hover.candle.open.toFixed(2)}
          </span>
          <span className="text-text-dim ml-2">H</span>
          <span className="text-text-primary">{hover.candle.high.toFixed(2)}</span>
          <span className="text-text-dim ml-2">L</span>
          <span className="text-text-primary">{hover.candle.low.toFixed(2)}</span>
          <span className="text-text-dim ml-2">C</span>
          <span className={hover.candle.close >= hover.candle.open ? 'text-accent-green' : 'text-accent-red'}>
            {hover.candle.close.toFixed(2)}
          </span>
          {hover.candle.volume != null && (
            <>
              <span className="text-text-dim ml-2">V</span>
              <span className="text-text-primary">{(hover.candle.volume / 1e6).toFixed(1)}M</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
