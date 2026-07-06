"use client"

import { useState, useEffect, useRef } from 'react'
import { formatPriceUSD } from '@/lib/format'

interface PriceTagProps {
  value: number
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showFlash?: boolean
  className?: string
}

export function PriceTag({
  value,
  size = 'md',
  showFlash = true,
  className = '',
}: PriceTagProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const prevRef = useRef(value)

  useEffect(() => {
    if (!showFlash || value === prevRef.current) return
    setFlash(value > prevRef.current ? 'up' : 'down')
    prevRef.current = value
    const t = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(t)
  }, [value, showFlash])

  const sizeClass = {
    xs: 'text-[10px]',
    sm: 'text-[11px]',
    md: 'text-[12px]',
    lg: 'text-[14px]',
  }[size]

  const flashClass = flash === 'up'
    ? 'animate-pulse-green'
    : flash === 'down'
    ? 'animate-pulse-red'
    : ''

  return (
    <span
      className={`font-mono tabular-nums text-right ${sizeClass} ${flashClass} ${className}`}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {formatPriceUSD(value)}
    </span>
  )
}
