"use client"

import { useRef, useEffect } from "react"

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
}

export function Sparkline({ data, width = 80, height = 20, color }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const lo = Math.min(...data)
    const hi = Math.max(...data)
    const range = hi - lo || 1
    const step = width / (data.length - 1)

    const lineColor = color ?? (data[data.length - 1] >= data[0] ? '#00ff88' : '#ff3060')

    // Fill area under line
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let i = 0; i < data.length; i++) {
      const x = i * step
      const y = height - ((data[i] - lo) / range) * (height - 2) - 1
      ctx.lineTo(x, y)
    }
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fillStyle = lineColor === '#00ff88' ? 'rgba(0,255,136,0.1)' : 'rgba(255,48,96,0.1)'
    ctx.fill()

    // Stroke line
    ctx.beginPath()
    for (let i = 0; i < data.length; i++) {
      const x = i * step
      const y = height - ((data[i] - lo) / range) * (height - 2) - 1
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1.2
    ctx.stroke()
  }, [data, width, height, color])

  if (data.length < 2) return <span className="text-text-muted text-[10px]">—</span>

  return <canvas ref={canvasRef} style={{ width, height }} />
}
